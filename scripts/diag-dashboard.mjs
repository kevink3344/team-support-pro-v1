import dotenv from 'dotenv';
dotenv.config();
import sql from 'mssql';
const pool = await sql.connect({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_DATABASE,user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:true,trustServerCertificate:false}});
const q = `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN t.Status = 'Open' THEN 1 ELSE 0 END) AS open,
          SUM(CASE WHEN t.Status = 'In Progress' THEN 1 ELSE 0 END) AS inProgress,
          SUM(CASE WHEN t.Status = 'Pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN t.Priority = 'Critical' THEN 1 ELSE 0 END) AS critical
        FROM Tickets t
        INNER JOIN Teams tm ON tm.Id = t.TeamId
        WHERE t.TeamId = @p1 AND tm.OrganizationId = @p2
      `;
try{
  let r=await pool.request().input('p1',sql.NVarChar,'team-legacy-default-indian-education').input('p2',sql.NVarChar,'academics').query(q);
  console.log('direct mssql ok', r.recordset[0]);
}catch(e){ console.error('direct mssql fail', e.message); }
await pool.close();

// Now via app layer
const {getDb, dbGet} = await import('../server/db.ts');
try{
  const db=getDb();
  const row=await dbGet(db, `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN t.Status = 'Open' THEN 1 ELSE 0 END) AS open,
          SUM(CASE WHEN t.Status = 'In Progress' THEN 1 ELSE 0 END) AS inProgress,
          SUM(CASE WHEN t.Status = 'Pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN t.Priority = 'Critical' THEN 1 ELSE 0 END) AS critical
        FROM Tickets t
        INNER JOIN Teams tm ON tm.Id = t.TeamId
        WHERE t.TeamId = ? AND tm.OrganizationId = ?
      `, ['team-legacy-default-indian-education','academics']);
  console.log('via dbGet ok', row);
}catch(e){ console.error('via dbGet fail', e.message); console.error(e.stack); }
