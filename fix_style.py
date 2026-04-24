content = open('index.html').read()

override = """<style>
  html, body {
    background: #0B0F1A;
    color: #E6EDF7;
  }
  .bg-grid { display: none; }
  .header {
    background: #0F1B3D;
    border-bottom: 1px solid #1F2A44;
    position: relative;
  }
  .wrap, .hero, .section, .page, .content {
    max-width: 100%;
    width: 100%;
    background: transparent;
  }
  .hero__title { color: #E6EDF7; }
  .hero__title em { color: #F97316; }
  .hero__eyebrow { color: #94A3B8; border-color: #1F2A44; background: #121826; }
  .stat-card {
    background: #121826;
    border: 1px solid #1F2A44;
    color: #E6EDF7;
  }
  .stat-card__num { color: #F97316; }
  .stat-card__label { color: #64748B; }
  .staff-card {
    background: #121826;
    border: 1px solid #1F2A44;
    color: #E6EDF7;
  }
  .staff-card__name { color: #E6EDF7; }
  .staff-card__meta { color: #94A3B8; }
  .section-header, .section-title { color: #94A3B8; }
  .date-pill, .clock-pill {
    background: #1F2A44;
    color: #E6EDF7;
    border-color: #2A3A5F;
  }
  .pulse-dot { background: #22C55E; }
  .logo__text { color: #E6EDF7; }
  .logo__text span { color: #F97316; }
  .logo__mark { background: #F97316; }
</style>"""

content = content.replace('</head>', override + '\n</head>')
open('index.html','w').write(content)
print('done')
