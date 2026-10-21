import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { JwtPayload } from '../types/index.js';

/**
 * Accesso alla sezione bollettini, anagrafiche comprese.
 *
 * Il flag vale per tutti, responsabile incluso: il menu lo nasconde a chi non
 * ce l'ha, e un'eccezione qui direbbe il contrario di quello che si vede.
 * Non e' un vicolo cieco, perche' la spunta sta nella pagina Utenti, che il
 * flag non protegge: un responsabile puo' sempre abilitarsi da solo.
 *
 * Il flag è letto dal database a ogni richiesta e non dal token: il JWT dura
 * sette giorni, quindi metterlo dentro significherebbe non poter revocare
 * l'accesso prima della scadenza.
 *
 * `modello` dice quale flag serve: 1 i bollettini classici (e l'archivio del
 * responsabile), 2 la sezione "Bollettini Nuovi", `qualsiasi` le rotte comuni alle
 * due sezioni (allegati, veicoli, dettaglio e PDF del singolo bollettino).
 *
 * Restituisce false dopo aver già inviato il 403: il chiamante deve limitarsi
 * a uscire dall'handler.
 */
export async function assertAccessoBollettini(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  modello: 1 | 2 | 'qualsiasi' = 1
): Promise<boolean> {
  const user = request.user as JwtPayload;

  const dbUser = await fastify.prisma.utente.findUnique({
    where: { id: user.id },
    select: { abilitatoBollettini: true, abilitatoBollettini2: true },
  });

  const abilitato =
    modello === 1
      ? dbUser?.abilitatoBollettini
      : modello === 2
        ? dbUser?.abilitatoBollettini2
        : dbUser?.abilitatoBollettini || dbUser?.abilitatoBollettini2;

  if (!abilitato) {
    reply.status(403).send({ error: 'Non autorizzato ai bollettini' });
    return false;
  }

  return true;
}
