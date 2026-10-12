import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { randomBytes, randomInt } from "node:crypto";

// Port of the original api.php: same actions, same request/response format.
const db = getDatabase();

type Q = { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> };

class Fail extends Error {}
const fail = (m: string): never => {
  throw new Fail(m);
};

// PHP-style "?" placeholders -> Postgres $1, $2, ...
const pg = (s: string) => {
  let i = 0;
  return s.replace(/\?/g, () => "$" + ++i);
};
const q = (c: Q, s: string, p: unknown[] = []) => c.query(pg(s), p);
const row = async (c: Q, s: string, p: unknown[] = []) => (await q(c, s, p)).rows[0];
const rows = async (c: Q, s: string, p: unknown[] = []) => (await q(c, s, p)).rows;

const now = () => Math.floor(Date.now() / 1000);
const int = (v: any) => {
  if (typeof v === "boolean") return +v;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};
const cut = (s: string, n: number) => [...s].slice(0, n).join("");
const pick = <T,>(a: T[]) => a[randomInt(a.length)];
const shuffle = <T,>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const parse = (s: string | null, d: any) => {
  try {
    return s ? JSON.parse(s) : d;
  } catch {
    return d;
  }
};
const topKeys = (v: Record<string, number>) => {
  const mx = Math.max(...Object.values(v));
  return Object.keys(v).filter((k) => v[k] === mx).map(Number);
};

const lg = (c: Q, t: string, u = "", r = "", i = "") =>
  q(c, "INSERT INTO fs_log(ts,type,uid,room,info) VALUES(NOW(),?,?,?,?)", [t, u, r, cut(String(i), 250)]);

async function finish(c: Q, r: any, P: any[], w: string) {
  await q(c, "INSERT INTO fs_games(mode,room,players,winner,rounds,ts) VALUES('online',?,?,?,?,NOW())", [r.code, P.length, w, r.round]);
  for (const p of P) {
    const won = (p.role == "mafia") == (w == "mafia") ? 1 : 0;
    await q(c, "UPDATE fs_users SET games=games+1,wins=wins+? WHERE uid=?", [won, p.uid]);
    await q(c, "INSERT INTO fs_plays(uid,mode,role,won,rounds,ts) VALUES(?,'online',?,?,?,NOW())", [p.uid, p.role, won, r.round]);
  }
  await lg(c, "end", "", r.code, w);
}

// Advances the room to the next phase once everyone acted or the timer ran out.
async function tick(code: string) {
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    const r = await row(c, "SELECT * FROM fs_rooms WHERE code=? FOR UPDATE", [code]);
    if (!r || r.status != "play") return void (await c.query("COMMIT"));
    let P = await rows(c, "SELECT * FROM fs_players WHERE room=?", [code]);
    const al = P.filter((p) => p.alive);
    const night = r.phase == "night";
    const done = night
      ? !al.filter((p) => ["mafia", "doctor", "elder"].includes(p.role)).some((p) => p.act === null)
      : !al.some((p) => p.vote === null);
    if (!done && now() < r.phase_end) return void (await c.query("COMMIT"));
    const cfg = parse(r.cfg, {});
    const d = parse(r.data, {});
    const nm = (id: number) => P.find((p) => p.id == id);
    let ev: any = null;
    if (night) {
      const v: Record<string, number> = {};
      for (const p of al) if (p.role == "mafia" && p.act !== null) v[p.act] = (v[p.act] ?? 0) + 1;
      let tg: number | null = Object.keys(v).length ? pick(topKeys(v)) : null;
      if (tg === null) {
        const cand = al.filter((p) => p.role != "mafia");
        if (cand.length) tg = pick(cand).id;
      }
      let pr: number | null = null;
      for (const p of al) if (p.role == "doctor") pr = p.act;
      if (tg !== null && tg != pr) {
        await q(c, "UPDATE fs_players SET alive=0 WHERE id=?", [tg]);
        ev = { t: "n", k: "kill", pid: tg, name: nm(tg).name };
      } else ev = { t: "n", k: "saved" };
    } else {
      const v: Record<string, number> = {};
      for (const p of al) if (p.vote !== null) v[p.vote] = (v[p.vote] ?? 0) + 1;
      const cand = Object.keys(v).length ? topKeys(v) : [];
      if (cand.length == 1) {
        await q(c, "UPDATE fs_players SET alive=0 WHERE id=?", [cand[0]]);
        const o = nm(cand[0]);
        ev = { t: "d", k: "out", pid: o.id, name: o.name, role: o.role };
      } else ev = { t: "d", k: "tie" };
    }
    P = await rows(c, "SELECT * FROM fs_players WHERE room=?", [code]);
    const a = P.filter((p) => p.alive);
    const m = a.filter((p) => p.role == "mafia").length;
    const w = !m ? "citizens" : m >= a.length - m ? "mafia" : "";
    d.seq = (d.seq ?? 0) + 1;
    d.ev = ev;
    if (w) {
      await q(c, "UPDATE fs_rooms SET status='end',phase='end',winner=?,data=?,upd=NOW() WHERE code=?", [w, JSON.stringify(d), code]);
      await finish(c, r, P, w);
    } else {
      await q(c, "UPDATE fs_players SET act=NULL,vote=NULL WHERE room=?", [code]);
      const np = night ? "day" : "night";
      const sec = night ? cfg.vote : cfg.night;
      await q(c, "UPDATE fs_rooms SET phase=?,round=?,phase_end=?,data=?,upd=NOW() WHERE code=?", [np, r.round + (night ? 0 : 1), now() + sec, JSON.stringify(d), code]);
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function state(code: string, uid: string, after: number) {
  const c = db.pool;
  await tick(code);
  const r = await row(c, "SELECT * FROM fs_rooms WHERE code=?", [code]);
  if (!r) fail("الغرفة غير موجودة");
  const me = await row(c, "SELECT * FROM fs_players WHERE room=? AND uid=?", [code, uid]);
  if (!me) fail("الغرفة غير موجودة");
  const P = await rows(c, "SELECT * FROM fs_players WHERE room=? ORDER BY id", [code]);
  const d = parse(r.data, {});
  const end = r.status == "end";
  const day = r.phase == "day";
  const vc: Record<string, number> = {};
  for (const p of P) if (p.vote !== null && p.alive) vc[p.vote] = (vc[p.vote] ?? 0) + 1;
  const pl = P.map((p) => ({
    id: p.id,
    name: p.name,
    alive: !!p.alive,
    av: parse(p.av, null),
    host: p.id == r.host_pid,
    v: day ? vc[p.id] ?? 0 : 0,
    ...(end ? { role: p.role } : {}),
  }));
  const mates = me.role == "mafia" ? P.filter((p) => p.role == "mafia" && p.id != me.id).map((p) => p.id) : [];
  const chat = await rows(c, "SELECT id,name,msg,ch FROM fs_chat WHERE room=? AND id>? AND (ch='a' OR ?=1) ORDER BY id LIMIT 60", [code, int(after), me.role == "mafia" ? 1 : 0]);
  return {
    ok: 1,
    host: me.id == r.host_pid,
    room: { code, ed: r.ed, status: r.status, phase: r.phase, round: r.round, left: Math.max(0, r.phase_end - now()), winner: r.winner, cfg: parse(r.cfg, null), seq: d.seq ?? 0, ev: d.ev ?? null },
    me: { id: me.id, role: me.role, alive: !!me.alive, act: me.act, vote: me.vote, mates, chk: parse(me.info, {}) },
    players: pl,
    chat,
  };
}

const isUid = (u: unknown): u is string => typeof u === "string" && /^[a-f0-9]{24}$/.test(u);

async function handle(inp: any) {
  const c = db.pool;
  const a = inp.a ?? "";
  let uid = inp.uid ?? "";
  const code = String(inp.code ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

  if (a == "hello") {
    if (!isUid(uid)) uid = randomBytes(12).toString("hex");
    let u = await row(c, "SELECT * FROM fs_users WHERE uid=?", [uid]);
    if (!u) {
      await q(c, "INSERT INTO fs_users(uid,settings,created,seen) VALUES(?,'',NOW(),NOW())", [uid]);
      u = await row(c, "SELECT * FROM fs_users WHERE uid=?", [uid]);
    } else await q(c, "UPDATE fs_users SET seen=NOW() WHERE uid=?", [uid]);
    await lg(c, "visit", uid);
    return { ok: 1, uid, name: u.name, settings: parse(u.settings, null), games: u.games, wins: u.wins };
  }
  if (!isUid(uid)) fail("uid");
  let name = cut(String(inp.name ?? "").trim(), 12);

  switch (a) {
    case "save":
      await q(c, "UPDATE fs_users SET settings=?,name=CASE WHEN ?::text='' THEN name ELSE ?::text END,seen=NOW() WHERE uid=?", [JSON.stringify(inp.settings ?? {}), name, name, uid]);
      return { ok: 1 };

    case "game_end": {
      const w = ["mafia", "citizens"].includes(inp.winner) ? inp.winner : "citizens";
      const md = ["solo", "local"].includes(inp.mode) ? inp.mode : "solo";
      const won = inp.won ? 1 : 0;
      await q(c, "INSERT INTO fs_games(mode,players,winner,rounds,uid,ts) VALUES(?,?,?,?,?,NOW())", [md, int(inp.n), w, int(inp.rounds), uid]);
      await q(c, "UPDATE fs_users SET games=games+1,wins=wins+? WHERE uid=?", [won, uid]);
      const ro = ["mafia", "doctor", "elder", "citizen"].includes(inp.role) ? inp.role : "";
      await q(c, "INSERT INTO fs_plays(uid,mode,role,won,rounds,ts) VALUES(?,?,?,?,?,NOW())", [uid, md, ro, md == "local" ? null : won, int(inp.rounds)]);
      await lg(c, "end_" + md, uid, "", w);
      return { ok: 1 };
    }

    case "stats": {
      const t = await row(c, "SELECT COUNT(*) FILTER (WHERE won=1) w,COUNT(*) FILTER (WHERE won=0) l,COUNT(*) g FROM fs_plays WHERE uid=?", [uid]);
      const m: any = {};
      const rr: any = {};
      for (const x of await rows(c, "SELECT mode,COUNT(*) g,COUNT(*) FILTER (WHERE won=1) w FROM fs_plays WHERE uid=? GROUP BY mode", [uid])) m[x.mode] = { g: int(x.g), w: int(x.w) };
      for (const x of await rows(c, "SELECT role,COUNT(*) g,COUNT(*) FILTER (WHERE won=1) w FROM fs_plays WHERE uid=? AND role<>'' GROUP BY role", [uid])) rr[x.role] = { g: int(x.g), w: int(x.w) };
      return { ok: 1, g: int(t.g), w: int(t.w), l: int(t.l), m, r: rr };
    }

    case "room_create": {
      name = name || "Player";
      await q(c, "DELETE FROM fs_players WHERE room IN(SELECT code FROM fs_rooms WHERE upd<NOW()-INTERVAL '1 day')");
      await q(c, "DELETE FROM fs_chat WHERE room IN(SELECT code FROM fs_rooms WHERE upd<NOW()-INTERVAL '1 day')");
      await q(c, "DELETE FROM fs_rooms WHERE upd<NOW()-INTERVAL '1 day'");
      const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let cd: string;
      do cd = shuffle([...abc]).slice(0, 5).join("");
      while (await row(c, "SELECT 1 FROM fs_rooms WHERE code=?", [cd]));
      const cf = { max: 8, night: Math.max(10, Math.min(60, int(inp.night ?? 25))), vote: Math.max(15, Math.min(120, int(inp.vote ?? 45))) };
      await q(c, "INSERT INTO fs_rooms(code,ed,cfg,data,created,upd) VALUES(?,1,?,'{}',NOW(),NOW())", [cd, JSON.stringify(cf)]);
      const p = await row(c, "INSERT INTO fs_players(room,uid,name,av) VALUES(?,?,?,?) RETURNING id", [cd, uid, name, JSON.stringify(inp.av ?? null)]);
      await q(c, "UPDATE fs_rooms SET host_pid=? WHERE code=?", [p.id, cd]);
      await q(c, "UPDATE fs_users SET name=? WHERE uid=?", [name, uid]);
      await lg(c, "room_new", uid, cd);
      return { ok: 1, code: cd };
    }

    case "room_join": {
      const r = await row(c, "SELECT * FROM fs_rooms WHERE code=?", [code]);
      if (!r) fail("الغرفة غير موجودة");
      if (await row(c, "SELECT 1 FROM fs_players WHERE room=? AND uid=?", [code, uid])) return { ok: 1, code };
      if (r.status != "lobby") fail("بدأت اللعبة بالفعل");
      const n = int((await row(c, "SELECT COUNT(*) n FROM fs_players WHERE room=?", [code])).n);
      if (n >= parse(r.cfg, {}).max) fail("الغرفة ممتلئة");
      name = name || "Player";
      await q(c, "INSERT INTO fs_players(room,uid,name,av) VALUES(?,?,?,?)", [code, uid, name, JSON.stringify(inp.av ?? null)]);
      await q(c, "UPDATE fs_users SET name=? WHERE uid=?", [name, uid]);
      await lg(c, "join", uid, code, name);
      return { ok: 1, code };
    }

    case "room_state":
      return state(code, uid, inp.after ?? 0);

    case "room_cfg":
    case "room_again":
    case "room_start":
    case "act":
    case "chat":
    case "leave": {
      let r = await row(c, "SELECT * FROM fs_rooms WHERE code=?", [code]);
      let me = await row(c, "SELECT * FROM fs_players WHERE room=? AND uid=?", [code, uid]);
      if (!r || !me) fail("الغرفة غير موجودة");
      const host = me.id == r.host_pid;
      let cf = parse(r.cfg, {});
      const n = int((await row(c, "SELECT COUNT(*) n FROM fs_players WHERE room=?", [code])).n);

      if (a == "room_cfg") {
        if (!host || r.status != "lobby") fail("x");
        if (inp.ed != null) await q(c, "UPDATE fs_rooms SET ed=? WHERE code=?", [Math.max(1, Math.min(3, int(inp.ed))), code]);
        if (inp.cfg != null) {
          const x = inp.cfg;
          cf = { max: Math.max(5, n, Math.min(12, int(x.max))), night: Math.max(10, Math.min(60, int(x.night))), vote: Math.max(15, Math.min(120, int(x.vote))) };
          await q(c, "UPDATE fs_rooms SET cfg=? WHERE code=?", [JSON.stringify(cf), code]);
        }
        await q(c, "UPDATE fs_rooms SET upd=NOW() WHERE code=?", [code]);
        return { ok: 1 };
      }
      if (a == "room_again") {
        if (!host || r.status != "end") fail("x");
        await q(c, "UPDATE fs_players SET role='',alive=1,act=NULL,vote=NULL,info='{}' WHERE room=?", [code]);
        await q(c, "UPDATE fs_rooms SET status='lobby',phase='lobby',round=0,phase_end=0,winner='',data='{}',upd=NOW() WHERE code=?", [code]);
        await lg(c, "again", uid, code);
        return { ok: 1 };
      }
      if (a == "room_start") {
        if (!host || r.status != "lobby") fail("x");
        if (n < 5) fail("تحتاج 5 لاعبين على الأقل");
        const ids = shuffle((await rows(c, "SELECT id FROM fs_players WHERE room=?", [code])).map((x) => x.id));
        const roles = shuffle(["mafia", "mafia", "doctor", "elder", ...Array(ids.length - 4).fill("citizen")]);
        for (let i = 0; i < ids.length; i++) await q(c, "UPDATE fs_players SET role=?,alive=1,act=NULL,vote=NULL,info='{}' WHERE id=?", [roles[i], ids[i]]);
        await q(c, "UPDATE fs_rooms SET status='play',phase='night',round=1,phase_end=?,data=?,upd=NOW() WHERE code=?", [now() + cf.night, JSON.stringify({ seq: 1 }), code]);
        await lg(c, "start", uid, code, "n=" + n);
        return { ok: 1 };
      }
      if (a == "leave") {
        if (["lobby", "end"].includes(r.status)) {
          await q(c, "DELETE FROM fs_players WHERE id=?", [me.id]);
          const nx = await row(c, "SELECT id FROM fs_players WHERE room=? ORDER BY id LIMIT 1", [code]);
          if (!nx) {
            await q(c, "DELETE FROM fs_rooms WHERE code=?", [code]);
            await q(c, "DELETE FROM fs_chat WHERE room=?", [code]);
          } else if (host) await q(c, "UPDATE fs_rooms SET host_pid=? WHERE code=?", [nx.id, code]);
        }
        return { ok: 1 };
      }
      if (a == "chat") {
        const m = cut(String(inp.msg ?? "").trim(), 200);
        if (m === "" || (r.status == "play" && !me.alive)) fail("x");
        const ch = r.status == "play" && r.phase == "night" && me.role == "mafia" ? "m" : "a";
        await q(c, "INSERT INTO fs_chat(room,pid,name,msg,ch,ts) VALUES(?,?,?,?,?,?)", [code, me.id, me.name, m, ch, now()]);
        return { ok: 1 };
      }
      if (a == "act") {
        await tick(code);
        r = await row(c, "SELECT * FROM fs_rooms WHERE code=?", [code]);
        me = await row(c, "SELECT * FROM fs_players WHERE id=?", [me.id]);
        const tp = await row(c, "SELECT * FROM fs_players WHERE id=? AND room=?", [int(inp.t), code]);
        if (r.status != "play" || !me.alive || !tp || !tp.alive) fail("x");
        let res: any = null;
        if (r.phase == "night") {
          const ro = me.role;
          if (!["mafia", "doctor", "elder"].includes(ro) || me.act !== null) fail("x");
          if (ro == "mafia" && tp.role == "mafia") fail("x");
          if (ro == "elder") {
            if (tp.id == me.id) fail("x");
            const i = parse(me.info, {});
            i[tp.id] = tp.role == "mafia" ? 1 : 0;
            await q(c, "UPDATE fs_players SET info=? WHERE id=?", [JSON.stringify(i), me.id]);
            res = { name: tp.name, m: i[tp.id] };
          }
          await q(c, "UPDATE fs_players SET act=? WHERE id=?", [tp.id, me.id]);
        } else {
          if (tp.id == me.id) fail("x");
          await q(c, "UPDATE fs_players SET vote=? WHERE id=?", [tp.id, me.id]);
        }
        await tick(code);
        return { ok: 1, res };
      }
    }
  }
  return fail("?");
}

export default async (req: Request) => {
  let out: any;
  try {
    const inp = await req.json().catch(() => ({}));
    out = await handle(inp && typeof inp === "object" ? inp : {});
  } catch (e) {
    if (e instanceof Fail) out = { err: 1, m: e.message };
    else {
      console.error(e);
      out = { err: 1, m: "تعذر الاتصال بقاعدة البيانات" };
    }
  }
  return new Response(JSON.stringify(out), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};

export const config: Config = {
  path: "/api.php",
};
