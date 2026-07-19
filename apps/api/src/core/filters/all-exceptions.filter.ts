import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { RequestWithId } from '../middlewares/request-id.middleware';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const messageRecord = isRecord(message) ? message : undefined;

    // Build the standardized response format
    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: messageRecord?.message ?? message,
      error: messageRecord?.error,
    };

    // Log the error
    const requestId = request.requestId || '';
    if (status >= 500) {
      this.logger.error(
        JSON.stringify({
          method: request.method,
          url: request.url,
          status,
          requestId,
          error:
            exception instanceof Error ? exception.stack : String(exception),
        }),
      );
    } else {
      this.logger.warn(
        JSON.stringify({
          method: request.method,
          url: request.url,
          status,
          requestId,
          message:
            typeof message === 'string' ? message : JSON.stringify(message),
        }),
      );
    }

    response.status(status).json(errorResponse);
  }
}
