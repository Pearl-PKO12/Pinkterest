import { MockUserDto } from '@server/fixtures';
import { app, mh, prisma } from './setup/setupTests.e2e';
import request from 'supertest';
import { AuthService } from '@server/modules/auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import Mail from 'nodemailer/lib/mailer';
import { RefreshTokenDto } from '@schema/auth';

async function retry<U>(
    fn: () => U | Promise<U> | null | undefined,
    maxAttempts = 3,
    interval = 500,
): Promise<U | null> {
    let attempts = 0;
    while (attempts < maxAttempts) {
        // return retry();
        const result = await fn();

        if (result) return result;

        await new Promise((resolve) => setTimeout(resolve, interval));
        attempts += 1;
    }
    return null;
}

describe('Auth', () => {
    describe('Sign Up', () => {
        it('should successfully sign up a new user', async () => {
            let response = await request(app.getHttpServer())
                .post('/user/signup')
                .send(MockUserDto)
                .expect(200);
            expect(response.body).toHaveProperty('access_token');
            expect(response.body).toHaveProperty('refresh_token');
            const createdUser = await prisma.user.findUnique({
                where: { email: MockUserDto.email },
            });
            expect(createdUser).toBeTruthy();
        });

        it('should return 400 if the user already exists', async () => {
            const authService = app.get(AuthService);
            await authService.signUp(MockUserDto);

            await request(app.getHttpServer())
                .post('/user/signup')
                .send(MockUserDto)
                .expect(400);
        });
    });

    describe('Sign in', () => {
        it('Should successfully sign in a new user', async () => {
            const authService = app.get(AuthService);
            await authService.signUp(MockUserDto);

            const response = await request(app.getHttpServer())
                .post('/user/login')
                .send(MockUserDto)
                .expect(200);

            expect(response.body).toHaveProperty('access_token');
            expect(response.body).toHaveProperty('refresh_token');

            const { access_token, refresh_token } = response.body;

            const jwtService = app.get(JwtService);
            const token: RefreshTokenDto = await jwtService.verifyAsync(
                refresh_token,
                {
                    secret: app
                        .get(ConfigService)
                        .get<string>('JWT_REFRESH_SECRET'),
                },
            );

            // console.log("token", token);

            const session = await prisma.session.findUnique({
                where: { id: token.jti },
            });
            expect(session).toBeTruthy();
            expect(session?.user_id).toEqual(token.sub);
        });

        it('should return 404 if user does not exist', async () => {
            await request(app.getHttpServer())
                .post('/user/login')
                .send(MockUserDto)
                .expect(HttpStatus.NOT_FOUND);
        });

        it('should return 403 if password is incorrect', async () => {
            await app.get(AuthService).signUp(MockUserDto);

            await request(app.getHttpServer())
                .post('/user/login')
                .send({ ...MockUserDto, password: 'wrongpassword' })
                .expect(HttpStatus.FORBIDDEN);
        });
    });

    describe('Token', () => {
        it('Refresh token to get new access token', async () => {
            const authService = app.get(AuthService);
            await authService.signUp(MockUserDto);
            const jwtService = app.get(JwtService);

            const loginResponse = await request(app.getHttpServer())
                .post('/user/login')
                .send(MockUserDto)
                .expect(HttpStatus.OK);

            expect(loginResponse.body).toHaveProperty('refresh_token');

            const { refresh_token } = loginResponse.body;

            // verify refresh token
            const veryifRefreshToken: RefreshTokenDto =
                await jwtService.verifyAsync(refresh_token, {
                    secret: app
                        .get(ConfigService)
                        .get<string>('JWT_REFRESH_SECRET'),
                });

            const refreshResponse = await request(app.getHttpServer())
                .post('/user/refresh')
                .set('Authorization', `Bearer ${refresh_token}`)
                .expect(200);

            expect(refreshResponse.body).toHaveProperty('access_token');

            const { access_token } = refreshResponse.body;

            const verifyAccessToken: RefreshTokenDto =
                await jwtService.verifyAsync(access_token, {
                    secret: app
                        .get(ConfigService)
                        .get<string>('JWT_ACCESS_SECRET'),
                });

            await request(app.getHttpServer())
                .get('/user/profile')
                .set('Authorization', `Bearer ${access_token}`)
                .expect(HttpStatus.OK);
        });

        it('Access token has valid claims', () => {});

        it('Should throw 401 error for invalid or expired refresh and access tokens', async () => {
            const invalidToken = 'invalid-token';

            // invalid refresh token
            await request(app.getHttpServer())
                .post('/user/refresh')
                .set('Authorization', `Bearer ${invalidToken}`)
                .expect(HttpStatus.UNAUTHORIZED);

            // invalid access token
            await request(app.getHttpServer())
                .get('/user/profile')
                .set('Authorization', `Bearer ${invalidToken}`)
                .expect(HttpStatus.UNAUTHORIZED);
        });
    });

    it('should successfully log out user', async () => {
        const jwtService = app.get(JwtService);

        const responseBody = await request(app.getHttpServer())
            .post('/user/signup')
            .send(MockUserDto)
            .expect(HttpStatus.OK);

        const { refresh_token } = responseBody.body;

        await request(app.getHttpServer())
            .post('/user/logout')
            .set('Authorization', `Bearer ${refresh_token}`)
            .expect(HttpStatus.OK);

        const refreshToken: RefreshTokenDto =
            await jwtService.decode(refresh_token);
        const session = await prisma.session.findUnique({
            where: { id: refreshToken.jti },
        });

        expect(session).toBeNull();
    });

    describe('Change password', () => {
        it('should successfully change a user password', async () => {
            const signupResponse = await request(app.getHttpServer())
                .post('/user/signup')
                .send(MockUserDto)
                .expect(HttpStatus.OK);

            const { access_token } = signupResponse.body;

            await request(app.getHttpServer())
                .post('/user/change-password')
                .send({
                    oldPassword: MockUserDto.password,
                    newPassword: 'new password',
                })
                .set('Authorization', `Bearer ${access_token}`)
                .expect(HttpStatus.OK);

            await request(app.getHttpServer())
                .post('/user/login')
                .send(MockUserDto)
                .expect(HttpStatus.FORBIDDEN);

            await request(app.getHttpServer())
                .post('/user/login')
                .send({ ...MockUserDto, password: 'new password' })
                .expect(HttpStatus.OK);
        });

        it('should throw Forbidden error if user submits a wrong password', async () => {
            const signupResponse = await request(app.getHttpServer())
                .post('/user/signup')
                .send(MockUserDto)
                .expect(HttpStatus.OK);

            const { access_token } = signupResponse.body;

            await request(app.getHttpServer())
                .post('/user/change-password')
                .send({
                    oldPassword: 'wrong password',
                    newPassword: 'new password',
                })
                .set('Authorization', `Bearer ${access_token}`)
                .expect(HttpStatus.FORBIDDEN);
        });
    });

    describe('Password Recovery', () => {
        it('Should handle password recovery flow', async () => {
            const emailQueue = app.get<Queue>(getQueueToken('email'));

            const signupResponse = await request(app.getHttpServer())
                .post('/user/signup')
                .send(MockUserDto)
                .expect(HttpStatus.OK);

            const { refresh_token } = signupResponse.body;

            // const emailSentPromise = new Promise<void>((resolve) => {
            //     mh.on('latest', (email) => {
            //       if (email.to === 'ksa@da.com') {
            //         resolve();
            //       }
            //     });
            //   });

            const jobProcessedPromise = new Promise<void>((resolve) => {
                emailQueue.on('progress', (job: Job) => {
                    if (job.name === 'password-reset') {
                        console.log('yeah');
                        resolve();
                    }
                });
            });

            await request(app.getHttpServer())
                .post('/user/forgot-password')
                .send({ email: MockUserDto.email })
                .expect(200);

            const job = await emailQueue.getJob('password-reset');

            // await new Promise((resolve) => setTimeout(resolve, 1000));

            // await jobProcessedPromise;

            // const result = await mh.latestTo('ksa@da.com');
            const result = await retry(async () => await mh.latestTo("ksa@da.com"), 5)

            expect(result).toBeDefined();
            

            const match = result!.html.match(/\?token=(.+?)"/)!;
            expect(match).toBeDefined();

            const token = match[1];

            // test ramndom token

            await request(app.getHttpServer())
                .post('/user/reset-password')
                .send({ token: token, newPassword: 'newPassword' })
                .expect(200);

            // can login in with new password
            await request(app.getHttpServer())
                .post('/user/login')
                .send({ email: MockUserDto.email, password: 'newPassword' })
                .expect(200);

            // cannot login with old password
            await request(app.getHttpServer())
                .post('/user/login')
                .send(MockUserDto)
                .expect(HttpStatus.FORBIDDEN);

            // invalidate existing refresh tokens
            await request(app.getHttpServer())
                .post('/user/refresh')
                .set('Authorization', `Bearer ${refresh_token}`)
                .expect(HttpStatus.UNAUTHORIZED);
        });
    });
});
