import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";

// Port of the original result.php statistics page.
const db = getDatabase();

const h = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]!);
const one = async (s: string) => {
  try {
    return Object.values((await db.pool.query(s)).rows[0] ?? {})[0] ?? 0;
  } catch {
    return 0;
  }
};
const all = async (s: string) => {
  try {
    return (await db.pool.query(s)).rows;
  } catch {
    return [];
  }
};
const T = (c: string) => `to_char(${c},'YYYY-MM-DD HH24:MI:SS') ${c.split(".").pop()}`;

export default async (req: Request) => {
  const key = Netlify.env.get("RESULT_KEY");
  if (key && new URL(req.url).searchParams.get("k") !== key) return new Response(null, { status: 404 });

  const st: [string, string][] = [
    ["المستخدمون", "SELECT COUNT(*) FROM fs_users"],
    ["متصلون الآن (5 د)", "SELECT COUNT(*) FROM fs_users WHERE seen>NOW()-INTERVAL '5 minutes'"],
    ["مستخدمون جدد اليوم", "SELECT COUNT(*) FROM fs_users WHERE created>CURRENT_DATE"],
    ["إجمالي الألعاب", "SELECT COUNT(*) FROM fs_games"],
    ["ألعاب اليوم", "SELECT COUNT(*) FROM fs_games WHERE ts>CURRENT_DATE"],
    ["اللاعبون في الألعاب", "SELECT COALESCE(SUM(players),0) FROM fs_games"],
    ["الغرف المنشأة", "SELECT COUNT(*) FROM fs_log WHERE type='room_new'"],
    ["غرف نشطة الآن", "SELECT COUNT(*) FROM fs_rooms WHERE status<>'end' AND upd>NOW()-INTERVAL '1 hour'"],
    ["فوز المافيا", "SELECT COUNT(*) FROM fs_games WHERE winner='mafia'"],
    ["فوز المواطنين", "SELECT COUNT(*) FROM fs_games WHERE winner='citizens'"],
    ["متوسط الجولات", "SELECT ROUND(COALESCE(AVG(rounds),0),1) FROM fs_games"],
    ["رسائل الشات", "SELECT COUNT(*) FROM fs_chat"],
    ["زيارات الموقع", "SELECT COUNT(*) FROM fs_log WHERE type='visit'"],
  ];
  const vals = await Promise.all(st.map((s) => one(s[1])));
  const [modes, top, gm, lg, rm] = await Promise.all([
    all("SELECT mode,COUNT(*) c FROM fs_games GROUP BY mode"),
    all("SELECT name,games,wins FROM fs_users WHERE games>0 ORDER BY wins DESC,games DESC LIMIT 10"),
    all(`SELECT mode,players,winner,rounds,${T("ts")} FROM fs_games ORDER BY id DESC LIMIT 15`),
    all(`SELECT ${T("ts")},type,room,info FROM fs_log ORDER BY id DESC LIMIT 40`),
    all(`SELECT r.code,r.status,r.phase,r.round,${T("r.upd")},(SELECT COUNT(*) FROM fs_players p WHERE p.room=r.code) n FROM fs_rooms r ORDER BY r.upd DESC LIMIT 10`),
  ]);
  const mn: Record<string, string> = { solo: "فردي", local: "جهاز واحد", online: "أونلاين" };
  const wn: Record<string, string> = { mafia: "المافيا", citizens: "المواطنون" };
  const tr = (cells: unknown[]) => "<tr>" + cells.map((x) => `<td>${h(x)}</td>`).join("") + "</tr>";

  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="20"><title>النتائج والإحصائيات</title>
<style>*{box-sizing:border-box;font-family:Tahoma,sans-serif}body{margin:0;background:#07070c;color:#fff;padding:16px;max-width:980px;margin:auto}h1{text-align:center;text-shadow:0 0 18px #fff6}h2{margin:26px 0 10px;font-size:20px;border-inline-start:4px solid #4cff00;padding-inline-start:10px}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.c{background:#15151d;border:1px solid #ffffff22;border-radius:14px;padding:14px;text-align:center;box-shadow:0 0 18px #ffffff10}.c b{display:block;font-size:30px;color:#4cff00}.c span{font-size:13px;opacity:.8}
table{width:100%;border-collapse:collapse;background:#15151d;border-radius:12px;overflow:hidden;font-size:14px}td,th{padding:8px 10px;border-bottom:1px solid #ffffff14;text-align:right}th{background:#1e1e2a}.w{overflow-x:auto}a{color:#3ee0ff}.ft{text-align:center;opacity:.55;font-size:12px;margin:30px 0 8px}</style></head><body>
<h1>النتائج والإحصائيات</h1><div style="text-align:center;opacity:.7">تحديث تلقائي كل 20 ثانية</div>
<h2>نظرة عامة</h2><div class="g">${st.map((s, i) => `<div class="c"><b>${h(vals[i])}</b><span>${h(s[0])}</span></div>`).join("")}${modes.map((m) => `<div class="c"><b>${h(m.c)}</b><span>ألعاب ${h(mn[m.mode] ?? m.mode)}</span></div>`).join("")}</div>
<h2>أفضل اللاعبين</h2><div class="w"><table><tr><th>#</th><th>الاسم</th><th>الألعاب</th><th>الفوز</th></tr>${top.map((t, i) => tr([i + 1, t.name || "—", t.games, t.wins])).join("")}</table></div>
<h2>الغرف</h2><div class="w"><table><tr><th>الكود</th><th>الحالة</th><th>المرحلة</th><th>الجولة</th><th>اللاعبون</th><th>آخر نشاط</th></tr>${rm.map((r) => tr([r.code, r.status, r.phase, r.round, r.n, r.upd])).join("")}</table></div>
<h2>آخر الألعاب</h2><div class="w"><table><tr><th>الوقت</th><th>النظام</th><th>اللاعبون</th><th>الفائز</th><th>الجولات</th></tr>${gm.map((r) => tr([r.ts, mn[r.mode] ?? r.mode, r.players, wn[r.winner] ?? r.winner, r.rounds])).join("")}</table></div>
<h2>سجل الأحداث (Log)</h2><div class="w"><table><tr><th>الوقت</th><th>النوع</th><th>الغرفة</th><th>تفاصيل</th></tr>${lg.map((r) => tr([r.ts, r.type, r.room, r.info])).join("")}</table></div>
<div class="ft">تم التصميم من قبل Fazber Studio</div></body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow, noarchive", "Cache-Control": "no-store" },
  });
};

export const config: Config = {
  path: ["/result.php", "/result"],
};
