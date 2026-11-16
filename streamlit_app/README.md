# AI Grid Trader: earlier analyst prototype (Streamlit)

> **This is the original prototype, kept for reference.** It uses simulated prices and a
> perfect-foresight agent only. The main product is the web demo at the repository root
> (live at https://baizakisaev.com), which adds a full year of real
> market prices, forecast-driven trading, a hindsight benchmark and automated tests.
> Numbers from the two versions are not directly comparable.

It is still useful for a deeper look at a single 48-hour plan: a decision log with CSV export
and a heatmap of the learned policy.

```bash
pip install -r requirements.txt
python -m streamlit run app.py
```
