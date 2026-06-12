import { BadRequestException } from '@nestjs/common';
import {
  validateUpload,
  sniffContent,
  multerFileFilter,
  UPLOAD_MAX_FILE_SIZE,
  ALLOWED_UPLOAD_TYPES,
  ALLOWED_MIMES,
  ALLOWED_EXTS,
} from './upload-validation';

function makeFile(
  overrides: Partial<{
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  }> = {},
) {
  return {
    originalname: 'test.pdf',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.from('%PDF-1.4 test content'),
    ...overrides,
  };
}

describe('upload-validation', () => {
  describe('ALLOWED_UPLOAD_TYPES', () => {
    it('includes PDF, Word, Excel, CSV, TXT, PNG, JPEG', () => {
      const mimes = new Set(ALLOWED_UPLOAD_TYPES.map((t) => t.mime));
      expect(mimes.has('application/pdf')).toBe(true);
      expect(
        mimes.has(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
      ).toBe(true);
      expect(
        mimes.has(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      ).toBe(true);
      expect(mimes.has('text/csv')).toBe(true);
      expect(mimes.has('text/plain')).toBe(true);
      expect(mimes.has('image/png')).toBe(true);
      expect(mimes.has('image/jpeg')).toBe(true);
    });
  });

  describe('ALLOWED_MIMES / ALLOWED_EXTS exports', () => {
    it('exports sets for reuse by fileFilter', () => {
      expect(ALLOWED_MIMES).toBeInstanceOf(Set);
      expect(ALLOWED_EXTS).toBeInstanceOf(Set);
      expect(ALLOWED_MIMES.has('application/pdf')).toBe(true);
      expect(ALLOWED_EXTS.has('.pdf')).toBe(true);
    });
  });

  describe('validateUpload', () => {
    it('accepts a valid PDF file with matching magic', () => {
      expect(() => validateUpload(makeFile())).not.toThrow();
    });

    it('accepts a valid .docx file with zip magic', () => {
      const zipMagic = Buffer.from([
        0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00,
      ]);
      expect(() =>
        validateUpload(
          makeFile({
            originalname: 'report.docx',
            mimetype:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            buffer: zipMagic,
          }),
        ),
      ).not.toThrow();
    });

    it('accepts a valid .xlsx file with zip magic', () => {
      const zipMagic = Buffer.from([
        0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00,
      ]);
      expect(() =>
        validateUpload(
          makeFile({
            originalname: 'data.xlsx',
            mimetype:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            buffer: zipMagic,
          }),
        ),
      ).not.toThrow();
    });

    it('accepts a valid CSV file', () => {
      expect(() =>
        validateUpload(
          makeFile({
            originalname: 'import.csv',
            mimetype: 'text/csv',
            buffer: Buffer.from('a,b,c\n1,2,3'),
          }),
        ),
      ).not.toThrow();
    });

    it('accepts a valid PNG image with matching magic', () => {
      const pngMagic = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      expect(() =>
        validateUpload(
          makeFile({
            originalname: 'photo.png',
            mimetype: 'image/png',
            size: 5 * 1024 * 1024,
            buffer: pngMagic,
          }),
        ),
      ).not.toThrow();
    });

    it('accepts a valid JPEG image with matching magic', () => {
      const jpegMagic = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00, 0x00,
      ]);
      expect(() =>
        validateUpload(
          makeFile({
            originalname: 'photo.jpeg',
            mimetype: 'image/jpeg',
            buffer: jpegMagic,
          }),
        ),
      ).not.toThrow();
    });

    it('accepts .doc with OLE magic', () => {
      const oleMagic = Buffer.from([
        0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
      ]);
      expect(() =>
        validateUpload(
          makeFile({
            originalname: 'old.doc',
            mimetype: 'application/msword',
            buffer: oleMagic,
          }),
        ),
      ).not.toThrow();
    });

    it('accepts .xls with OLE magic', () => {
      const oleMagic = Buffer.from([
        0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
      ]);
      expect(() =>
        validateUpload(
          makeFile({
            originalname: 'old.xls',
            mimetype: 'application/vnd.ms-excel',
            buffer: oleMagic,
          }),
        ),
      ).not.toThrow();
    });

    it('rejects when file is undefined', () => {
      expect(() => validateUpload(undefined)).toThrow(BadRequestException);
      expect(() => validateUpload(undefined)).toThrow('请上传文件');
    });

    it('rejects file exceeding size limit', () => {
      const oversized = UPLOAD_MAX_FILE_SIZE + 1;
      expect(() => validateUpload(makeFile({ size: oversized }))).toThrow(
        BadRequestException,
      );
      expect(() => validateUpload(makeFile({ size: oversized }))).toThrow(
        '文件大小超过限制',
      );
    });

    it('accepts file at exactly the size limit', () => {
      expect(() =>
        validateUpload(makeFile({ size: UPLOAD_MAX_FILE_SIZE })),
      ).not.toThrow();
    });

    it('rejects disallowed MIME type', () => {
      expect(() =>
        validateUpload(
          makeFile({
            originalname: 'script.js',
            mimetype: 'application/javascript',
          }),
        ),
      ).toThrow(BadRequestException);
      expect(() =>
        validateUpload(
          makeFile({
            originalname: 'script.js',
            mimetype: 'application/javascript',
          }),
        ),
      ).toThrow('不支持的文件类型');
    });

    it('rejects MIME/extension mismatch', () => {
      expect(() =>
        validateUpload(
          makeFile({
            originalname: 'file.txt',
            mimetype: 'application/pdf',
          }),
        ),
      ).toThrow(BadRequestException);
      expect(() =>
        validateUpload(
          makeFile({
            originalname: 'file.txt',
            mimetype: 'application/pdf',
          }),
        ),
      ).toThrow('文件扩展名');
    });

    it('rejects very short buffer for binary types', () => {
      expect(() =>
        validateUpload(
          makeFile({
            originalname: 'tiny.pdf',
            mimetype: 'application/pdf',
            buffer: Buffer.from([0x25, 0x50]),
          }),
        ),
      ).toThrow('文件内容过短');
    });

    it('rejects extension not in allowed set for a valid MIME', () => {
      expect(() =>
        validateUpload(
          makeFile({
            originalname: 'file.exe',
            mimetype: 'image/png',
          }),
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('sniffContent magic bytes', () => {
    it('rejects fake PDF (ZIP magic instead)', () => {
      const zipMagic = Buffer.from([
        0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00,
      ]);
      expect(() =>
        sniffContent(
          makeFile({
            originalname: 'fake.pdf',
            mimetype: 'application/pdf',
            buffer: zipMagic,
          }),
        ),
      ).toThrow('PDF 文件内容不合法');
    });

    it('rejects fake PNG (random bytes)', () => {
      const random = Buffer.from([
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
      ]);
      expect(() =>
        sniffContent(
          makeFile({
            originalname: 'fake.png',
            mimetype: 'image/png',
            buffer: random,
          }),
        ),
      ).toThrow('PNG 文件内容不合法');
    });

    it('rejects fake JPEG (random bytes)', () => {
      const random = Buffer.from([
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
      ]);
      expect(() =>
        sniffContent(
          makeFile({
            originalname: 'fake.jpeg',
            mimetype: 'image/jpeg',
            buffer: random,
          }),
        ),
      ).toThrow('JPEG 文件内容不合法');
    });

    it('rejects fake docx (random bytes, not ZIP)', () => {
      const random = Buffer.from([
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
      ]);
      expect(() =>
        sniffContent(
          makeFile({
            originalname: 'fake.docx',
            mimetype:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            buffer: random,
          }),
        ),
      ).toThrow('Office 文档内容不合法');
    });

    it('rejects fake doc (random bytes, not OLE)', () => {
      const random = Buffer.from([
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
      ]);
      expect(() =>
        sniffContent(
          makeFile({
            originalname: 'fake.doc',
            mimetype: 'application/msword',
            buffer: random,
          }),
        ),
      ).toThrow('Office 文档内容不合法');
    });

    it('rejects txt with NUL bytes', () => {
      const withNul = Buffer.from('hello\x00world');
      expect(() =>
        sniffContent(
          makeFile({
            originalname: 'bad.txt',
            mimetype: 'text/plain',
            buffer: withNul,
          }),
        ),
      ).toThrow('NUL 字节');
    });

    it('rejects csv with NUL bytes', () => {
      const withNul = Buffer.from('a,b\x00c');
      expect(() =>
        sniffContent(
          makeFile({
            originalname: 'bad.csv',
            mimetype: 'text/csv',
            buffer: withNul,
          }),
        ),
      ).toThrow('NUL 字节');
    });
  });

  describe('multerFileFilter', () => {
    const cb = jest.fn();

    beforeEach(() => cb.mockReset());

    it('accepts valid MIME + extension', () => {
      multerFileFilter(
        {} as Express.Request,
        { originalname: 'test.pdf', mimetype: 'application/pdf' },
        cb,
      );
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('rejects disallowed MIME', () => {
      multerFileFilter(
        {} as Express.Request,
        { originalname: 'script.js', mimetype: 'application/javascript' },
        cb,
      );
      expect(cb).toHaveBeenCalledWith(expect.any(BadRequestException), false);
    });

    it('rejects MIME/extension mismatch', () => {
      multerFileFilter(
        {} as Express.Request,
        { originalname: 'file.txt', mimetype: 'application/pdf' },
        cb,
      );
      expect(cb).toHaveBeenCalledWith(expect.any(BadRequestException), false);
    });
  });
});
