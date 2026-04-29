import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as Minio from 'minio';
import { PrismaService } from '../prisma/prisma.service';

if (!process.env.MINIO_ACCESS_KEY) {
  throw new Error('Missing required environment variable: MINIO_ACCESS_KEY');
}
if (!process.env.MINIO_SECRET_KEY) {
  throw new Error('Missing required environment variable: MINIO_SECRET_KEY');
}

@Injectable()
export class FilesService {
  private minioClient: Minio.Client;
  private readonly logger = new Logger(FilesService.name);
  private readonly BUCKET_NAME = 'eip-files';

  constructor(private readonly prisma: PrismaService) {
    this.minioClient = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT || '127.0.0.1',
      port: parseInt(process.env.MINIO_PORT || '9000'),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
    });

    this.initBucket();
  }
  private async initBucket() {
    try {
      const exists = await this.minioClient.bucketExists(this.BUCKET_NAME);
      if (!exists) {
        await this.minioClient.makeBucket(this.BUCKET_NAME, 'us-east-1');
        this.logger.log(`Bucket ${this.BUCKET_NAME} created successfully`);
      }
    } catch (error) {
      this.logger.error('Failed to initialize MinIO bucket', error);
    }
  }

  async uploadFile(
    file: Express.Multer.File,
    companyId: string,
    uploaderId: string,
    customPath?: string,
  ) {
    // 按公司 ID 将图纸和文件隔离分发到不同目录夹，如 eip-files/CompanyID/2026-03/...
    const extension = file.originalname.split('.').pop();
    const objectName = `${companyId}/${customPath ? customPath + '/' : ''}${Date.now()}-${Math.round(Math.random() * 1e4)}.${extension}`;

    try {
      await this.minioClient.putObject(
        this.BUCKET_NAME,
        objectName,
        file.buffer,
        file.size,
        { 'Content-Type': file.mimetype },
      );

      // Save to database
      const fileRecord = await this.prisma.fileRecord.create({
        data: {
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          objectKey: objectName,
          companyId,
          uploaderId,
        },
      });

      // 返回系统内的唯一定位符
      return {
        id: fileRecord.id,
        url: objectName,
        fileName: file.originalname,
        size: file.size,
      };
    } catch (err) {
      throw new InternalServerErrorException(
        'Failed to upload drawing file strictly',
      );
    }
  }

  async getFilesByCompany(companyId: string) {
    const files = await this.prisma.fileRecord.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        uploader: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // Provide pre-signed URLs directly for ease of access
    return Promise.all(
      files.map(async (file) => {
        const url = await this.getFilePresignedUrl(file.objectKey);
        return { ...file, downloadUrl: url };
      }),
    );
  }
  async getFilePresignedUrl(objectName: string) {
    // 获取有时间限制（默认1小时）的安全下载/预览链接，防止文件被直接拖走泄漏
    return this.minioClient.presignedGetObject(
      this.BUCKET_NAME,
      objectName,
      3600,
    );
  }
}
