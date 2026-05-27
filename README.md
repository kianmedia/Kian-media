# Kian Al Ebtikar — Media Production Website

Premium cinematic one-page website for **Kian Al Ebtikar For Art Production** (كيان الابتكار للإنتاج الفني).

## Tech Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **Framer Motion** (animations)
- **Vercel** (deployment)

## Design

- **Colors**: Black `#080808` · Red `#c0392b` · White `#ffffff`
- **Style**: Luxury cinematic, corporate B2B, RTL Arabic + English
- **Features**: Custom cursor, film grain, filmstrip animation, scroll reveal

## Sections

1. **Hero** — Showreel CTA + YouTube embed modal + stats strip
2. **Marquee** — Animated services ticker
3. **Services** — 6 service cards (Cinematic, Drone, Live, Corporate, Weddings, Documentary)
4. **Portfolio** — Filterable grid with YouTube embeds
5. **About** — Brand story + stats
6. **Process** — 4-step workflow (light bg)
7. **Testimonials** — Client quotes + logos
8. **Contact** — WhatsApp CTA + email + phone
9. **Footer** — Full links + socials

## Setup

```bash
npm install
npm run dev       # http://localhost:3000
npm run build
npm run start
```

## Add Your Logo

Place your logo file at:
```
public/logo.png
```
(PNG with transparency, square format recommended)

## Update YouTube IDs

In `components/Portfolio.tsx`, replace the `youtubeId` values with your real YouTube video IDs:

```ts
{ youtubeId: "YOUR_VIDEO_ID_HERE", ... }
```

For the Hero showreel embed in `components/Hero.tsx`:
```ts
src="https://www.youtube.com/embed/YOUR_PLAYLIST_OR_VIDEO_ID?autoplay=1"
```

## Deploy to Vercel

### Option 1: Vercel CLI
```bash
npm i -g vercel
vercel login
vercel --prod
```

### Option 2: GitHub → Vercel Dashboard
1. Push to GitHub: `git push origin main`
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import your GitHub repo
4. Framework: **Next.js** (auto-detected)
5. Click **Deploy**

### Option 3: Vercel Deploy Button
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=YOUR_REPO_URL)

## Push to GitHub

```bash
git init
git add .
git commit -m "feat: Kian Media premium cinematic website"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/kian-media.git
git push -u origin main
```

## Environment Variables

No environment variables required for the base setup.

## Custom Domain

In Vercel Dashboard → Project Settings → Domains → Add `kianmedia.com`

---

Built with ❤️ for **كيان الابتكار للإنتاج الفني**
