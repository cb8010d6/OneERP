import { BadRequestException } from '@nestjs/common';
import { extname } from 'path';

export const UPLOAD_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export interface AllowedType {
  mime: string;
  ext: string;
}

export const ALLOWED_UPLOAD_TYPES: readonly AllowedType[] = [
  { mime: 'application/pdf', ext: '.pdf' },
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: '.docx',
  },
  { mime: 'application/msword', ext: '.doc' },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: '.xlsx',
  },
  { mime: 'application/vnd.ms-excel', ext: '.xls' },
  { mime: 'text/csv', ext: '.csv' },
  { mime: 'text/plain', ext: '.txt' },
  { mime: 'image/png', ext: '.png' },
  { mime: 'image/jpeg', ext: '.jpg' },
  { mime: 'image/jpeg', ext: '.jpeg' },
];

export const ALLOWED_MIMES = new Set(ALLOWED_UPLOAD_TYPES.map((t) => t.mime));
export const ALLOWED_EXTS = new Set(ALLOWED_UPLOAD_TYPES.map((t) => t.ext));

const MIME_TO_EXTS = new Map<string, Set<string>>();
for (const t of ALLOWED_UPLOAD_TYPES) {
  if (!MIME_TO_EXTS.has(t.mime)) {
    MIME_TO_EXTS.set(t.mime, new Set());
  }
  MIME_TO_EXTS.get(t.mime)!.add(t.ext);
}

export interface UploadLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer?: Buffer;
}

interface MagicSignature {
  mime: string;
  magic: number[];
  offset: number;
}

const MAGIC_BYTES: MagicSignature[] = [
  { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46], offset: 0 },
  { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47], offset: 0 },
  { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff], offset: 0 },
  { mime: 'application/zip', magic: [0x50, 0x4b, 0x03, 0x04], offset: 0 },
  {
    mime: 'application/msword',
    magic: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    offset: 0,
  },
];

function startsWithMagic(buf: Buffer, sig: MagicSignature): boolean {
  if (buf.length < sig.offset + sig.magic.length) return false;
  return sig.magic.every((byte, i) => buf[sig.offset + i] === byte);
}

export function sniffContent(file: UploadLike): void {
  if (!file.buffer) return;

  const ext = extname(file.originalname).toLowerCase();

  if (['.txt', '.csv'].includes(ext)) {
    if (file.buffer.includes(0x00)) {
      throw new BadRequestException('txt/csv 文件不允许包含 NUL 字节');
    }
    return;
  }

  if (file.buffer.length < 8) {
    throw new BadRequestException('文件内容过短，无法验证');
  }

  const pdfSig = MAGIC_BYTES[0];
  const pngSig = MAGIC_BYTES[1];
  const jpegSig = MAGIC_BYTES[2];
  const zipSig = MAGIC_BYTES[3];
  const oleSig = MAGIC_BYTES[4];

  if (ext === '.pdf') {
    if (!startsWithMagic(file.buffer, pdfSig)) {
      throw new BadRequestException('PDF 文件内容不合法（magic bytes 不匹配）');
    }
    return;
  }

  if (ext === '.png') {
    if (!startsWithMagic(file.buffer, pngSig)) {
      throw new BadRequestException('PNG 文件内容不合法（magic bytes 不匹配）');
    }
    return;
  }

  if (['.jpg', '.jpeg'].includes(ext)) {
    if (!startsWithMagic(file.buffer, jpegSig)) {
      throw new BadRequestException(
        'JPEG 文件内容不合法（magic bytes 不匹配）',
      );
    }
    return;
  }

  if (['.docx', '.xlsx'].includes(ext)) {
    if (!startsWithMagic(file.buffer, zipSig)) {
      throw new BadRequestException(
        'Office 文档内容不合法（zip magic bytes 不匹配）',
      );
    }
    return;
  }

  if (['.doc', '.xls'].includes(ext)) {
    if (!startsWithMagic(file.buffer, oleSig)) {
      throw new BadRequestException(
        'Office 文档内容不合法（OLE magic bytes 不匹配）',
      );
    }
    return;
  }
}

export function validateUpload(file: UploadLike | undefined): void {
  if (!file) {
    throw new BadRequestException('请上传文件');
  }

  if (file.size > UPLOAD_MAX_FILE_SIZE) {
    throw new BadRequestException(
      `文件大小超过限制，最大允许 ${UPLOAD_MAX_FILE_SIZE / 1024 / 1024} MB`,
    );
  }

  if (!ALLOWED_MIMES.has(file.mimetype)) {
    throw new BadRequestException(
      `不支持的文件类型 "${file.mimetype}"，仅允许 PDF、Word、Excel、CSV、TXT、PNG、JPEG`,
    );
  }

  const ext = extname(file.originalname).toLowerCase();
  const expectedExts = MIME_TO_EXTS.get(file.mimetype);
  if (!ext || !expectedExts?.has(ext)) {
    throw new BadRequestException(
      `文件扩展名 "${ext}" 与内容类型 "${file.mimetype}" 不匹配`,
    );
  }

  sniffContent(file);
}

export function multerFileFilter(
  _req: Express.Request,
  file: { originalname: string; mimetype: string },
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  const ext = extname(file.originalname).toLowerCase();
  if (!ALLOWED_MIMES.has(file.mimetype) || !ALLOWED_EXTS.has(ext)) {
    callback(
      new BadRequestException(
        `不支持的文件类型 "${file.mimetype}"，仅允许 PDF、Word、Excel、CSV、TXT、PNG、JPEG`,
      ),
      false,
    );
    return;
  }
  const expectedExts = MIME_TO_EXTS.get(file.mimetype);
  if (!expectedExts?.has(ext)) {
    callback(
      new BadRequestException(
        `文件扩展名 "${ext}" 与内容类型 "${file.mimetype}" 不匹配`,
      ),
      false,
    );
    return;
  }
  callback(null, true);
}
