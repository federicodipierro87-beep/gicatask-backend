/**
 * Cognome prima del nome: e' l'ordine con cui si cercano le persone in un
 * elenco. Il `trim` non e' difensivo — l'account amministratore ha il `nome`
 * vuoto di proposito, e senza trim uscirebbe "Amministratore " con lo spazio.
 */
export function nomeUtente(u: { nome: string; cognome: string }): string {
  return `${u.cognome} ${u.nome}`.trim();
}
