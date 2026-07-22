import { PrismaClient, Ruolo } from '@prisma/client';
import bcrypt from 'bcryptjs';

export async function runSeed(prisma: PrismaClient): Promise<string> {
  // Check if already seeded
  const existingUsers = await prisma.utente.count();
  if (existingUsers > 0) {
    return 'Database already seeded. Skipping.';
  }

  // Create users
  const passwordHash = await bcrypt.hash('admin123', 10);
  const dipPassword = await bcrypt.hash('dip123', 10);

  const responsabile = await prisma.utente.create({
    data: {
      nome: 'Mario',
      cognome: 'Rossi',
      passwordHash,
      ruolo: Ruolo.RESPONSABILE,
      attivo: true,
    },
  });

  await prisma.utente.create({
    data: {
      nome: 'Luigi',
      cognome: 'Verdi',
      passwordHash: null,
      ruolo: Ruolo.DIPENDENTE,
      attivo: true,
    },
  });

  await prisma.utente.create({
    data: {
      nome: 'Anna',
      cognome: 'Bianchi',
      passwordHash: null,
      ruolo: Ruolo.DIPENDENTE,
      attivo: true,
    },
  });

  await prisma.utente.create({
    data: {
      nome: 'Giuseppe',
      cognome: 'Neri',
      passwordHash: dipPassword,
      ruolo: Ruolo.DIPENDENTE,
      attivo: true,
    },
  });

  // Helper function to create generic cantiere
  async function createGenericCantiere(clienteId: number) {
    const cantiere = await prisma.cantiere.create({
      data: {
        clienteId,
        nome: 'Generico',
        isGenerico: true,
        attivo: true,
      },
    });

    await prisma.tipoAttivita.createMany({
      data: [
        { cantiereId: cantiere.id, nome: 'Consulenza' },
        { cantiereId: cantiere.id, nome: 'Supporto' },
        { cantiereId: cantiere.id, nome: 'Altro' },
      ],
    });

    return cantiere;
  }

  // Client 1
  const cliente1 = await prisma.cliente.create({
    data: { nome: 'Azienda Trasporti SpA', attivo: true },
  });
  await createGenericCantiere(cliente1.id);

  // Client 2
  const cliente2 = await prisma.cliente.create({
    data: { nome: 'Logistica Nord Srl', attivo: true },
  });
  await createGenericCantiere(cliente2.id);

  const cantiere2a = await prisma.cantiere.create({
    data: {
      clienteId: cliente2.id,
      nome: 'Magazzino Milano',
      isGenerico: false,
      attivo: true,
    },
  });
  await prisma.tipoAttivita.createMany({
    data: [
      { cantiereId: cantiere2a.id, nome: 'Carico/Scarico' },
      { cantiereId: cantiere2a.id, nome: 'Inventario' },
      { cantiereId: cantiere2a.id, nome: 'Manutenzione' },
    ],
  });

  const cantiere2b = await prisma.cantiere.create({
    data: {
      clienteId: cliente2.id,
      nome: 'Hub Torino',
      isGenerico: false,
      attivo: true,
    },
  });
  await prisma.tipoAttivita.createMany({
    data: [
      { cantiereId: cantiere2b.id, nome: 'Smistamento' },
      { cantiereId: cantiere2b.id, nome: 'Spedizioni' },
    ],
  });

  // Client 3
  const cliente3 = await prisma.cliente.create({
    data: { nome: 'Express Delivery', attivo: true },
  });
  await createGenericCantiere(cliente3.id);

  const cantiere3a = await prisma.cantiere.create({
    data: {
      clienteId: cliente3.id,
      nome: 'Centro Distribuzione Roma',
      isGenerico: false,
      attivo: true,
    },
  });
  await prisma.tipoAttivita.createMany({
    data: [
      { cantiereId: cantiere3a.id, nome: 'Picking' },
      { cantiereId: cantiere3a.id, nome: 'Packing' },
      { cantiereId: cantiere3a.id, nome: 'Consegna' },
    ],
  });

  // Configuration
  await prisma.configurazione.createMany({
    data: [
      { chiave: 'backup_retention_days', valore: '30' },
      { chiave: 'finestra_modifica_giorni', valore: '7' },
    ],
  });

  return 'Seed completed! Users: Mario Rossi (admin123), Giuseppe Neri (dip123), Luigi Verdi (no pwd), Anna Bianchi (no pwd)';
}
