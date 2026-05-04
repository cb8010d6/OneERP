import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import type {
  JwtTokenPayload,
  JwtUserPayload,
} from '../../core/http/request.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'EIP_SECRET_KEY_SUPER_SECURE',
    });
  }

  validate(payload: JwtTokenPayload): JwtUserPayload {
    // payload.sub is the user UUID
    return { id: payload.sub, email: payload.email };
  }
}
