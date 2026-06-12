import { multerFileFilter, UPLOAD_MAX_FILE_SIZE } from './upload-validation';

export const multerUploadOptions = {
  limits: { fileSize: UPLOAD_MAX_FILE_SIZE },
  fileFilter: multerFileFilter,
};
