# User guide

How to present the demo, use your own price data, and navigate it with assistive technology.

[Back to the project overview](../README.md)

## Presenting it

| To… | Do this |
|---|---|
| Run it unattended on a screen | Open **[baizakisaev.com/ai-grid-trader?kiosk=1](https://baizakisaev.com/ai-grid-trader?kiosk=1)**. It goes full-window and auto-plays every market while the headline numbers count up, with a QR code to LinkedIn in the corner. Scrolling keeps it playing; a tap, click or key hands control to the visitor; after 60 s idle it starts again. |
| Start or stop auto-play by hand | Click **Auto-play**, or press **K** |
| Switch market | Click a chip, or press **1–7** (four simulated, then California, Germany, South Australia) |
| Show a different 48 hours | Click **New day** or press **N** (real markets: or pick dates from the menu) |
| Show the realistic vs. ideal agent | **Agent sees: Forecast / Perfect hindsight**, or press **H** |
| Explain a decision | Click any ▲ or ▼ on the chart, or **explain the first trade** below it |
| Make the point about battery health | Drag **Wear cost per cycle** to $0 and watch the AI start micro-cycling |
| Talk beyond trading | Scroll to **Revenue streams** and **Battery lifetime** |
| Run it on a prospect's own prices | **Upload CSV** ([format](#uploading-a-csv)) |
| Leave a one-page business case | **Business case** → enter their name → *Save as PDF* in the print window |
| Send the exact scenario you showed | **Share**: the link stores every setting |
| Light or dark | The sun/moon button, or **T** (remembered) |
| Full screen | **Present**, or **F** |

**No Wi-Fi at the venue?** Open [the demo](https://baizakisaev.com/ai-grid-trader) once while you're
online; after that it opens with no connection, because the browser keeps a copy. You can also
install it like an app: the install icon in Chrome or Edge's address bar, or *Share → Add to Home
Screen* on iPad and iPhone. As a last resort, download this repo (**Code → Download ZIP**), unzip
it and open `ai-grid-trader.html`.

**Sharing the link** on LinkedIn, Slack or email shows a preview card (`assets/og.png`). LinkedIn
caches previews; after changing the image, refresh it with the
[LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/).

## Uploading a CSV

Any CSV with a price column works, ideally with a timestamp column: 5, 15, 30 or 60-minute data,
at least 48 hours (up to a year is used; four weeks or more also gets the full-year view, scaled to
365 days). Comma or semicolon separated, decimal points or commas. The file is processed only in
the visitor's browser and never uploaded, and it isn't included in Share links.

```
timestamp,price_eur_mwh
2025-06-02 00:00,61.20
2025-06-02 01:00,58.75
...
```

## Accessibility

Every control works with the keyboard and shows a focus ring. Charts carry text descriptions for
screen readers, including the main chart's price range, trades and profit. **Explain the first
trade** opens "Why this trade?" without a mouse, and explanations are announced to screen readers.
Text contrast meets WCAG AA in both themes. An automated audit (axe-core) runs on every push.
