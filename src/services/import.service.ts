import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';

interface ImportRow {
  cliente: string;
  cantiere: string;
  tipoAttivita: string;
}

interface ImportResult {
  success: boolean;
  clientiCreati: number;
  cantieriCreati: number;
  tipiAttivitaCreati: number;
  righeProcessate: number;
  errori: string[];
}

export class ImportService {
  constructor(private prisma: PrismaClient) {}

  async importFromExcel(buffer: Buffer): Promise<ImportResult> {
    const workbook = new ExcelJS.Workbook();
    // Convert Node Buffer to ArrayBuffer for ExcelJS compatibility
    const arrayBuffer = new Uint8Array(buffer).buffer;
    await workbook.xlsx.load(arrayBuffer as ArrayBuffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return {
        success: false,
        clientiCreati: 0,
        cantieriCreati: 0,
        tipiAttivitaCreati: 0,
        righeProcessate: 0,
        errori: ['Nessun foglio trovato nel file Excel'],
      };
    }

    const rows: ImportRow[] = [];
    const errori: string[] = [];

    // Parse rows (skip header row)
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      const cliente = this.getCellValue(row.getCell(1));
      const cantiere = this.getCellValue(row.getCell(2));
      const tipoAttivita = this.getCellValue(row.getCell(3));

      if (!cliente) {
        errori.push(`Riga ${rowNumber}: Cliente mancante`);
        return;
      }

      rows.push({
        cliente: cliente.trim(),
        cantiere: cantiere?.trim() || 'Generico',
        tipoAttivita: tipoAttivita?.trim() || '',
      });
    });

    if (rows.length === 0) {
      return {
        success: false,
        clientiCreati: 0,
        cantieriCreati: 0,
        tipiAttivitaCreati: 0,
        righeProcessate: 0,
        errori: errori.length > 0 ? errori : ['Nessuna riga valida trovata nel file'],
      };
    }

    // Process rows
    let clientiCreati = 0;
    let cantieriCreati = 0;
    let tipiAttivitaCreati = 0;

    // Cache to avoid duplicate lookups
    const clientiCache = new Map<string, number>();
    const cantieriCache = new Map<string, number>();
    const tipiCache = new Map<string, number>();

    for (const row of rows) {
      try {
        // 1. Get or create client
        let clienteId = clientiCache.get(row.cliente.toLowerCase());

        if (!clienteId) {
          const existingCliente = await this.prisma.cliente.findFirst({
            where: { nome: { equals: row.cliente, mode: 'insensitive' } },
          });

          if (existingCliente) {
            clienteId = existingCliente.id;
          } else {
            // Create client with automatic "Generico" cantiere
            const newCliente = await this.prisma.cliente.create({
              data: {
                nome: row.cliente,
                cantieri: {
                  create: {
                    nome: 'Generico',
                    isGenerico: true,
                  },
                },
              },
              include: { cantieri: true },
            });
            clienteId = newCliente.id;
            clientiCreati++;

            // Cache the generic cantiere
            const genericoCantiere = newCliente.cantieri.find(c => c.isGenerico);
            if (genericoCantiere) {
              cantieriCache.set(`${clienteId}-generico`, genericoCantiere.id);
            }
          }
          clientiCache.set(row.cliente.toLowerCase(), clienteId);
        }

        // 2. Get or create cantiere
        const cantiereKey = `${clienteId}-${row.cantiere.toLowerCase()}`;
        let cantiereId = cantieriCache.get(cantiereKey);

        if (!cantiereId) {
          const existingCantiere = await this.prisma.cantiere.findFirst({
            where: {
              clienteId,
              nome: { equals: row.cantiere, mode: 'insensitive' },
            },
          });

          if (existingCantiere) {
            cantiereId = existingCantiere.id;
          } else {
            const newCantiere = await this.prisma.cantiere.create({
              data: {
                nome: row.cantiere,
                clienteId,
                isGenerico: row.cantiere.toLowerCase() === 'generico',
              },
            });
            cantiereId = newCantiere.id;
            cantieriCreati++;
          }
          cantieriCache.set(cantiereKey, cantiereId);
        }

        // 3. Get or create tipo attività (only if specified)
        if (row.tipoAttivita) {
          const tipoKey = row.tipoAttivita.toLowerCase();
          let tipoId = tipiCache.get(tipoKey);

          if (!tipoId) {
            const existingTipo = await this.prisma.tipoAttivita.findFirst({
              where: {
                nome: { equals: row.tipoAttivita, mode: 'insensitive' },
              },
            });

            if (!existingTipo) {
              await this.prisma.tipoAttivita.create({
                data: {
                  nome: row.tipoAttivita,
                },
              });
              tipiAttivitaCreati++;
            }
            tipiCache.set(tipoKey, existingTipo?.id || -1);
          }
        }
      } catch (error: any) {
        errori.push(`Errore processando "${row.cliente} > ${row.cantiere}": ${error.message}`);
      }
    }

    return {
      success: errori.length === 0,
      clientiCreati,
      cantieriCreati,
      tipiAttivitaCreati,
      righeProcessate: rows.length,
      errori,
    };
  }

  private getCellValue(cell: ExcelJS.Cell): string | null {
    if (!cell || cell.value === null || cell.value === undefined) {
      return null;
    }

    // Handle different cell types
    if (typeof cell.value === 'string') {
      return cell.value;
    }

    if (typeof cell.value === 'number') {
      return cell.value.toString();
    }

    if (typeof cell.value === 'object' && 'text' in cell.value) {
      return (cell.value as { text: string }).text;
    }

    if (typeof cell.value === 'object' && 'richText' in cell.value) {
      return (cell.value as { richText: Array<{ text: string }> }).richText
        .map(r => r.text)
        .join('');
    }

    return cell.text || null;
  }

  async generateTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Import');

    // Add header row
    worksheet.columns = [
      { header: 'Cliente', key: 'cliente', width: 30 },
      { header: 'Cantiere', key: 'cantiere', width: 30 },
      { header: 'Tipo Attività', key: 'tipoAttivita', width: 30 },
    ];

    // Style header
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add example rows
    worksheet.addRow({ cliente: 'Esempio Cliente 1', cantiere: 'Magazzino Nord', tipoAttivita: 'Carico/Scarico' });
    worksheet.addRow({ cliente: 'Esempio Cliente 1', cantiere: 'Magazzino Nord', tipoAttivita: 'Picking' });
    worksheet.addRow({ cliente: 'Esempio Cliente 1', cantiere: 'Magazzino Sud', tipoAttivita: 'Inventario' });
    worksheet.addRow({ cliente: 'Esempio Cliente 2', cantiere: 'Generico', tipoAttivita: 'Trasporto' });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
