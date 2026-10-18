SLUG: how-river-flood-forecasts-work-and-what-the-number-means
TITLE: How River Flood Forecasts Work — and What the Flow Number Means
EXCERPT: "290 m³/s, at the 91st percentile of the past year" is a sentence that can decide whether you move a car to higher ground. A guide to discharge, river gauges, and satellite flood models.
TAGS: flooding, rivers, weather, climate, safety

## Discharge: The Number Behind the Headline

Hydrologists describe a river with one core number: **discharge** — the volume of water passing a point per second, measured in cubic metres per second (m³/s). A small country stream might run at 2 m³/s; the Amazon at its mouth averages around 200,000. The reason discharge, not "water level," is the working unit: level depends on the riverbed's shape at one spot, while discharge is the actual quantity of water, and it is what doubles when a flood arrives.

The relationship between the two is not linear, and that is the trap. A riverbed that carries 300 m³/s comfortably at mid-channel might overflow its banks at 600 and inundate a town at 900, because the extra 300 has nowhere wide to go. This is why "the rate doubled" can mean "the flooding tripled" — width and depth squeeze the meaning out of raw numbers near the banks.

## The River Gauge: A Boring Hero

The traditional instrument is the **gauging station**: a ladder, stilling well or sensor on the bank, logging level continuously, converted to discharge through a site-specific rating curve built by hand-measuring flow across the channel with current meters and boats over years. Gauges are accurate and local — and sparse. Rich countries gauge their major rivers well; most of Africa, Central Asia and South America's river networks have thin or decaying gauge coverage, and many stations have stopped reporting since the 2000s. The world's largest rivers are, in instrumentation terms, surprisingly blind.

## Enter the Satellite-and-Computer Compromise

When there is no gauge where you need one, you model. The European Commission's GloFAS (Global Flood Awareness System) runs a hydrological model over every river basin on Earth, fed by weather-satellite rainfall, and outputs *simulated* river flow daily — with seasonal and medium-range forecasts. Open-Meteo republishes these model estimates for any coordinate, which is how a weather page can show a flood-risk card for a city whose nearest physical gauge may be 300 km upstream.

The honesty part matters: a modelled flow at your exact town is not a gauge reading at your exact town. It represents the river reach the model cell covers, it smooths the rating-curve chaos near banks, and its skill against real floods is good for *trends and anomalies* — "this week's flow sits in the top 5% of the past year" — rather than centimetre-precise riverbank truth. Systems like GloFAS exist to give days of lead time across the whole planet, which they genuinely do: flood anomalies can be flagged 3–10 days ahead of the water arriving.

## Reading a Risk Card Like a Local

If you want to judge your own river from flow numbers, three habits cover most of the value:

1. **Percentile beats absolute.** 400 m³/s means nothing without knowing that the same river's median is 120 and its record is 900. Top-10%-of-the-year is the actionable statement; the raw number is trivia.
2. **Trend beats snapshot.** A falling flow at the 95th percentile is a receding flood; a rising flow at the 60th is tomorrow's problem. Three days of slope tell you more than today's peak value.
3. **Rain upstream is water downstream, later.** Flood peaks travel — a storm 200 km up the valley arrives at your town as a flow rise 1–3 days later, and the model card shows that lag as a rising series before the local sky clears.

## Where to Check Your River

Tukuk's **[World Weather](https://tukuk.org/cuaca)** city pages include a river-flow risk card built on exactly this stack — a year of GloFAS history for percentile context, the last five weeks of trend, and the model's own disclosure that it is not a physical gauge. Try **[London](https://tukuk.org/cuaca/london)** or **[Kuala Lumpur](https://tukuk.org/cuaca/kuala-lumpur)** and look under the air-quality box: the sparkline tells you whether the local river is running like a normal Tuesday or like one it hasn't had this year.
