import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { JwtPayload } from '../types/index.js';

/**
 * Accesso alla sezione "Noleggi": stesso schema di `assertAccessoBollettini`.
 * Il flag vale per tutti, responsabile compreso, ed e' letto dal database a
 * ogni richiesta e non dal token, cosi' una revoca ha effetto subito.
 *
 * Restituisce false dopo aver gia' inviato il 403: il chiamante deve limitarsi
 * a uscire dall'handler.
 */
export async function assertAccessoNoleggi(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const user = request.user as JwtPayload;

  const dbUser = await fastify.prisma.utente.findUnique({
    where: { id: user.id },
    select: { abilitatoNoleggi: true },
  });

  if (!dbUser?.abilitatoNoleggi) {
    reply.status(403).send({ error: 'Non autorizzato ai noleggi' });
    return false;
  }

  return true;
}
