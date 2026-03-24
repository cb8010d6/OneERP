import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'EIP_SECRET_KEY_SUPER_SECURE',
    });
  }

  async validate(payload: any) {
    // payload.sub is the user UUID
    return { id: payload.sub, email: payload.email };
  }
}
