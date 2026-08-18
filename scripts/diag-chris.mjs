import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config();
const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: true, trustServerCertificate: false },
});
let r = await pool.request().query(`SELECT Id, Name, Email, TeamId, OrganizationId, Role, CanViewAllOrgTickets FROM Users WHERE Name LIKE '%Chris%' OR Email LIKE '%chris%'`);
console.log('Users Chris:', JSON.stringify(r.recordset, null, 2));
r = await pool.request().query(`SELECT Id, Name, OrganizationId FROM Teams`);
console.log('Teams:', JSON.stringify(r.recordset, null, 2));
r = await pool.request().query(`SELECT COUNT(*) as cnt FROM Tickets`);
console.log('Tickets total:', r.recordset[0]);
r = await pool.request().query(`SELECT TeamId, COUNT(*) as cnt FROM Tickets GROUP BY TeamId`);
console.log('Tickets by TeamId:', JSON.stringify(r.recordset, null, 2));
r = await pool.request().query(`SELECT TOP 5 Id, Title, TeamId, Status FROM Tickets`);
console.log('Sample tickets:', JSON.stringify(r.recordset, null, 2));
r = await pool.request().query(`SELECT Id, Name FROM Organizations`);
console.log('Orgs:', JSON.stringify(r.recordset, null, 2));
let chris = await pool.request().query(`SELECT TeamId, OrganizationId FROM Users WHERE Name='Chris Rice'`);
if(chris.recordset[0]){
  let teamId = chris.recordset[0].TeamId;
  let orgId = chris.recordset[0].OrganizationId;
  console.log('Chris team', teamId, 'org', orgId);
  let t = await pool.request().input('teamId', sql.NVarChar, teamId).input('orgId', sql.NVarChar, orgId).query(`SELECT COUNT(*) as total FROM Tickets t INNER JOIN Teams tm ON tm.Id = t.TeamId WHERE t.TeamId=@teamId AND tm.OrganizationId=@orgId`);
  console.log('Dashboard stats query result for Chris:', t.recordset[0]);
  let t2 = await pool.request().input('orgId', sql.NVarChar, orgId).query(`SELECT COUNT(*) as total FROM Tickets t INNER JOIN Teams tm ON tm.Id = t.TeamId WHERE tm.OrganizationId=@orgId`);
  console.log('All org tickets:', t2.recordset[0]);
  // Check if Teams.OrganizationId matches
  let tm = await pool.request().input('teamId', sql.NVarChar, teamId).query(`SELECT * FROM Teams WHERE Id=@teamId`);
  console.log('Chris team row:', JSON.stringify(tm.recordset[0], null, 2));
}
await pool.close();
