import type { Ruolo } from '@prisma/client';

export interface JwtPayload {
  id: number;
  ruolo: Ruolo;
}

export interface AuthenticatedUser {
  id: number;
  nome: string;
  cognome: string;
  ruolo: Ruolo;
}

export interface LoginRequest {
  utenteId: number;
  password?: string;
}

export interface CheckPasswordResponse {
  hasPassword: boolean;
}

export interface UserListItem {
  id: number;
  nome: string;
  cognome: string;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}
