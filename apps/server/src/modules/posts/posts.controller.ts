import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    NotFoundException,
} from '@nestjs/common';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { Post as PostEntity, Prisma } from '@prisma/client';

@Controller('posts')
export class PostsController {
    constructor(private readonly postsService: PostsService) {}

    @Post()
    async create(@Body() createPostDto: CreatePostDto): Promise<PostEntity> {
        return await this.postsService.create(createPostDto);
    }

    @Patch(':id')
    async update(@Param('id') id: string, @Body() updatePostDto: UpdatePostDto) {
        return await this.postsService.update(id, updatePostDto);
    }

    @Delete(':id')
    async remove(@Param('id') id: string): Promise<PostEntity> {
        return await this.postsService.remove(id);
    }
}