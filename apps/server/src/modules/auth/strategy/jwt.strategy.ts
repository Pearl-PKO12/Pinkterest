import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { JwtToken, Token } from "@server/types/auth";
import { ExtractJwt, Strategy as JwtStrategy } from "passport-jwt";

@Injectable()
export class AccessTokenStrategy extends PassportStrategy(JwtStrategy, "jwt") {
    constructor(private configService: ConfigService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.get<string>("JWT_ACCESS_SECRET")
        })
    }

    validate(payload: JwtToken): Token {
        return payload.data;
    }
}