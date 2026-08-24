// Zentara — base vide. Les données proviennent UNIQUEMENT des APIs live :
// LinkedIn StaffSpy, SEC EDGAR, OpenStreetMap Overpass, backend tunnel.
// Aucune donnée pré-remplie — chaque recherche est fraîche.
export interface SeedData { generated_at: string; users: any[]; companies: any[]; prospects: any[]; contacts: any[]; campaigns: any[]; intelligence: any[]; emails: any[]; contracts: any[]; }
export const SEED: SeedData = {
 "generated_at": "2026-08-24T23:30:00.000Z",
 "users": [
  {
   "id": "usr_bb15fe9ca04a8428dadc",
   "email": "tunation.fr@gmail.com",
   "name": "Tuna",
   "role": "admin",
   "status": "active",
   "created_at": "2026-08-17T20:01:56.907Z",
   "updated_at": "2026-08-17T20:01:56.907Z"
  }
 ],
 "companies": [],
 "prospects": [],
 "contacts": [],
 "campaigns": [],
 "intelligence": [],
 "emails": [],
 "contracts": []
}
