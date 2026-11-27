// Vercel Function: lưu và đọc thông tin thiệp trong Upstash Redis (cài từ Vercel Marketplace).
// GET  /api/config  -> trả thông tin đã chỉnh (công khai, giống nội dung thiệp)
// PUT  /api/config  -> lưu thông tin mới, cần header x-admin-password khớp biến ADMIN_PASSWORD
const U = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const T = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'wedding-config';

const redis = async (...cmd) => {
  const r = await fetch(U, { method: 'POST', headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
};
const str = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const https = v => { v = str(v, 1500); return /^https:\/\//i.test(v) ? v : ''; };
const gmap = v => { v = https(v); return /^https:\/\/(www\.)?google\.com\/maps/i.test(v) ? v : ''; };
const fam = o => ({ father: str(o && o.father), mother: str(o && o.mother), address: str(o && o.address), oldAddress: str(o && o.oldAddress) });

function clean(b) {
  const d = str(b.date, 40), g = b.gift || {};
  return {
    groom: str(b.groom, 60), bride: str(b.bride, 60),
    groomFamily: fam(b.groomFamily), brideFamily: fam(b.brideFamily),
    ceremonyAt: str(b.ceremonyAt, 60),
    date: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\+07:00)?$/.test(d) ? d : null,
    lunar: str(b.lunar, 100), venue: str(b.venue, 100), address: str(b.address, 200),
    mapQuery: str(b.mapQuery, 200), mapEmbed: gmap(b.mapEmbed), mapUrl: https(b.mapUrl), embedMap: b.embedMap !== false,
    schedule: (Array.isArray(b.schedule) ? b.schedule : []).slice(0, 30).map(s => [str(s && s[0], 10), str(s && s[1], 120)]).filter(s => s[1]),
    gift: { bank: str(g.bank, 60), number: str(g.number, 40), holder: str(g.holder, 80) },
    albumUrl: https(b.albumUrl), groomPhoto: https(b.groomPhoto), bridePhoto: https(b.bridePhoto),
    photos: (Array.isArray(b.photos) ? b.photos : []).slice(0, 3).map(https).filter(Boolean),
    petals: b.petals !== false
  };
}

module.exports = async (req, res) => {
  if (!U || !T) return res.status(503).json({ error: 'Chưa kết nối kho dữ liệu Upstash Redis cho dự án này.' });
  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=60');
      const v = await redis('GET', KEY);
      return res.status(200).json(v ? JSON.parse(v) : {});
    }
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'PUT' && req.method !== 'POST') { res.setHeader('Allow', 'GET, PUT'); return res.status(405).json({ error: 'Không hỗ trợ' }); }
    const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
    const fk = 'fail:' + ip;
    if (Number(await redis('GET', fk)) >= 8) return res.status(429).json({ error: 'Nhập sai quá nhiều lần, hãy đợi 15 phút rồi thử lại.' });
    const pw = process.env.ADMIN_PASSWORD;
    if (!pw || req.headers['x-admin-password'] !== pw) {
      await redis('INCR', fk); await redis('EXPIRE', fk, 900);
      return res.status(401).json({ error: 'Sai mật khẩu quản trị.' });
    }
    await redis('DEL', fk);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
    await redis('SET', KEY, JSON.stringify(clean(body)));
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Lỗi máy chủ, bạn thử lại sau.' });
  }
};
