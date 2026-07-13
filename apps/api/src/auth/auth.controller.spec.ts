import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import type { ExecutionContext } from '@nestjs/common';

describe('AuthController (cookie-based)', () => {
  let app: INestApplication;
  const getTestServer = () =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const mockAuthService = {
    validateUser: jest.fn(),
    login: jest.fn(),
    register: jest.fn(),
    acceptInvite: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    logoutAll: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const httpContext = context.switchToHttp();
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          httpContext.getRequest().user = { id: 'u1', email: 'a@b.com' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/login', () => {
    it('returns accessToken and sets rt cookie', async () => {
      mockAuthService.validateUser.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        name: 'A',
        companies: [],
      });
      mockAuthService.login.mockResolvedValue({
        accessToken: 'at-123',
        refreshToken: 'rt-123',
        user: { id: 'u1', email: 'a@b.com', name: 'A' },
        companies: [],
      });

      const res = await request(getTestServer())
        .post('/auth/login')
        .send({ email: 'a@b.com', password: 'pass' })
        .expect(200);

      const body = res.body as { accessToken: string; refreshToken?: string };
      expect(body.accessToken).toBe('at-123');
      expect(body.refreshToken).toBeUndefined();
      const setCookie = res.headers['set-cookie'] as unknown as string[];
      expect(setCookie.some((c: string) => c.startsWith('rt=rt-123'))).toBe(
        true,
      );
      expect(setCookie.some((c: string) => c.startsWith('csrf='))).toBe(true);
      expect(
        setCookie.every(
          (c: string) =>
            c.includes('Path=/') || c.includes('path=/') || !c.includes('Path'),
        ),
      ).toBe(true);
    });
  });

  describe('POST /auth/refresh', () => {
    it('reads rt cookie and returns new accessToken', async () => {
      mockAuthService.refresh.mockResolvedValue({
        accessToken: 'at-new',
        refreshToken: 'rt-new',
        user: { id: 'u1', email: 'a@b.com', name: 'A' },
        companies: [],
      });

      const res = await request(getTestServer())
        .post('/auth/refresh')
        .set('Cookie', ['rt=rt-old', 'csrf=same-token'])
        .set('x-csrf-token', 'same-token')
        .send()
        .expect(200);

      const body = res.body as { accessToken: string };
      expect(body.accessToken).toBe('at-new');
      expect(mockAuthService.refresh).toHaveBeenCalledWith('rt-old');
      const setCookie = res.headers['set-cookie'] as unknown as string[];
      expect(setCookie.some((c: string) => c.startsWith('rt=rt-new'))).toBe(
        true,
      );
    });

    it('returns 401 when rt cookie is missing', async () => {
      await request(getTestServer())
        .post('/auth/refresh')
        .set('Cookie', ['csrf=same-token'])
        .set('x-csrf-token', 'same-token')
        .send()
        .expect(401);
    });

    it('returns 403 when CSRF header is missing', async () => {
      await request(getTestServer())
        .post('/auth/refresh')
        .set('Cookie', ['rt=rt-old', 'csrf=some-token'])
        .send()
        .expect(403);
    });

    it('returns 403 when CSRF cookie and header mismatch', async () => {
      await request(getTestServer())
        .post('/auth/refresh')
        .set('Cookie', ['rt=rt-old', 'csrf=token-a'])
        .set('x-csrf-token', 'token-b')
        .send()
        .expect(403);
    });
  });

  describe('POST /auth/logout', () => {
    it('clears rt and csrf cookies', async () => {
      mockAuthService.logout.mockResolvedValue({ success: true });

      const res = await request(getTestServer())
        .post('/auth/logout')
        .set('Cookie', ['rt=rt-123', 'csrf=csrf-123'])
        .set('x-csrf-token', 'csrf-123')
        .send()
        .expect(200);

      const body = res.body as { success: boolean };
      expect(body.success).toBe(true);
      const setCookie = res.headers['set-cookie'] as unknown as string[];
      expect(setCookie.some((c: string) => c.includes('rt=;'))).toBe(true);
      expect(setCookie.some((c: string) => c.includes('csrf=;'))).toBe(true);
    });
  });

  describe('POST /auth/logout-all', () => {
    it('calls authService.logoutAll', async () => {
      mockAuthService.logoutAll.mockResolvedValue({ success: true });

      await request(getTestServer())
        .post('/auth/logout-all')
        .set('Cookie', ['csrf=csrf-123'])
        .set('x-csrf-token', 'csrf-123')
        .send()
        .expect(200);

      expect(mockAuthService.logoutAll).toHaveBeenCalled();
    });
  });
});
