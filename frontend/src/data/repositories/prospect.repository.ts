import { getDatabase } from '../database/local-db';
import { Prospect } from '@/types';
import { generateId } from '@/lib/utils';

export const prospectRepository = {
  async getAll(): Promise<Prospect[]> {
    const db = await getDatabase();
    const result = await db.query('SELECT * FROM prospects ORDER BY created_at DESC');
    return (result.values || []) as Prospect[];
  },

  async getById(id: string): Promise<Prospect | undefined> {
    const db = await getDatabase();
    const result = await db.query('SELECT * FROM prospects WHERE id = ?', [id]);
    return result.values ? (result.values[0] as Prospect) : undefined;
  },

  async create(data: Omit<Prospect, 'id' | 'created_at' | 'updated_at'>): Promise<Prospect> {
    const db = await getDatabase();
    const id = generateId('pros');
    const now = new Date().toISOString();
    
    await db.run(
      `INSERT INTO prospects (
        id, company_id, first_name, last_name, email, phone, sector, 
        address, city, country, website, social_profiles, google_maps_url, 
        score, status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, data.company_id || null, data.first_name, data.last_name, data.email || null, 
        data.phone || null, data.sector || null, data.address || null, data.city || null, 
        data.country || null, data.website || null, JSON.stringify(data.social_profiles || {}), 
        data.google_maps_url || null, data.score || 0, data.status, data.notes || null, 
        now, now
      ]
    );
    
    return { ...data, id, created_at: now, updated_at: now } as Prospect;
  },

  async update(id: string, data: Partial<Prospect>): Promise<void> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    
    const fields = Object.keys(data).filter(key => key !== 'id');
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = fields.map(field => {
      const val = (data as any)[field];
      return typeof val === 'object' ? JSON.stringify(val) : val;
    });
    
    await db.run(
      `UPDATE prospects SET ${setClause}, updated_at = ? WHERE id = ?`,
      [...values, now, id]
    );
  },

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.run('DELETE FROM prospects WHERE id = ?', [id]);
  },

  async search(query: string): Promise<Prospect[]> {
    const db = await getDatabase();
    const searchTerm = `%${query}%`;
    const result = await db.query(
      `SELECT * FROM prospects 
       WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR sector LIKE ?`,
      [searchTerm, searchTerm, searchTerm, searchTerm]
    );
    return (result.values || []) as Prospect[];
  }
};
