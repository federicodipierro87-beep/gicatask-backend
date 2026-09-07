const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * La data del noleggio e' un giorno, non un istante: la colonna e' @db.Date e
 * Prisma la rilegge come mezzanotte UTC. Il suffisso esplicito rende evidente
 * che il fuso del server non deve entrare in gioco.
 */
export function parseDataSolo(valore: string): Date {
  if (!ISO_DATE.test(valore)) {
    throw new Error(`Data non valida: ${valore}`);
  }

  const data = new Date(`${valore}T00:00:00.000Z`);

  if (Number.isNaN(data.getTime())) {
    throw new Error(`Data non valida: ${valore}`);
  }

  return data;
}
