SLUG: how-gps-knows-where-you-are
TITLE: How GPS Knows Where You Are: Satellites, Atomic Clocks and Relativity
EXCERPT: Your phone pins you to within a few metres using signals from clocks orbiting 20,000 km away. Here is how GPS actually works — the timing trick, why it needs four satellites, and the relativity that keeps it honest.
TAGS: gps, technology, maps, science, navigation

## It Is a Timing Problem, Not a Positioning One

The Global Positioning System does not measure where you are directly. It measures **time** — and time is turned into distance. Every GPS satellite continuously broadcasts a signal containing two things: *which* satellite it is and *exactly when* the message was sent, stamped by an onboard atomic clock. Your receiver notes when the signal arrives. Because radio waves travel at the speed of light, the gap between "sent" and "received" tells the receiver how long the signal took — and multiplying that tiny travel time by the speed of light gives the distance to that satellite.

That is the whole idea. A single distance measurement says "you are somewhere on a huge sphere around this satellite." Each extra satellite narrows the sphere-sphere intersections down until only one point remains.

## Why Four Satellites and Not Three

In principle three satellite distances fix a point in space, but that assumes your clock is perfect. It isn't. Receiver clocks are cheap quartz, and even a **microsecond** of error throws the distance off by about 300 metres, because light travels that far in a millionth of a second. So the receiver treats its own clock error as a fourth unknown and solves for it with a **fourth satellite**: three dimensions of position plus one for clock bias. This is why you need four satellites in view, not three, and why GPS in a narrow canyon or a city "urban canyon" — where the sky view is blocked — struggles or jumps.

The geometry that lets satellites sit in fixed constellations is precise: about two dozen operational spacecraft spread over six orbital planes, each circling roughly every **12 hours** at about **20,200 km** altitude. That arrangement is designed so that, from anywhere on Earth, you always have enough satellites overhead to solve the equation.

## The Part That Sounds Wrong but Is Real: Relativity

Here is the most remarkable fact about GPS: it would fail within minutes if engineers ignored Einstein. Two relativistic effects tug at the satellite clocks in opposite directions.

- Because satellites move fast relative to the ground, **special relativity** says their clocks should tick *slightly slower*.
- Because they sit high in a weaker gravitational field, **general relativity** says their clocks should tick *slightly faster*.

The gravitational effect wins, and the net result is that satellite clocks run about **38 microseconds a day faster** than clocks on the ground. That sounds trivial, but at light-speed it is a positioning error that would pile up at roughly **10 kilometres a day**. GPS is built to compensate: the clocks are deliberately offset before launch and the receiver's maths folds in the corrections. Everyday navigation is quietly one of the most convincing real-world confirmations of relativity we have.

## Why Your Position Still Jitters

Even with perfect physics, a phone rarely fixes to a single stable point. The signal must punch through the **ionosphere and troposphere**, layers of atmosphere that slow the radio waves by amounts that depend on weather and solar activity — a delay the receiver models but cannot fully remove. Tall buildings and mountains **reflect** signals (multipath), so your receiver sometimes measures a longer, bounced path. And the satellites' geometry matters: when the visible satellites cluster in one part of the sky, the intersecting spheres meet at a shallow angle and small timing errors blow up into large position errors — a weakness engineers call poor "dilution of precision."

Consumer GPS is accurate to a few metres; survey-grade systems combining several frequencies and ground corrections reach centimetres.

## Putting a Location to Work

Once a device knows your coordinates — a latitude and longitude — the rest is geometry. Two points on Earth are not a straight-line distance, so the honest calculation uses the curvature of the planet (the great-circle or haversine distance), and time zones and sunrise times all cascade from that lat/lon. You can try each step yourself: measure the real distance between any two places on our [distance tool](https://tukuk.org/maps/distance), and explore mapping, sun and sky pages on the main [maps](https://tukuk.org/maps) hub — the same coordinate maths that powers the [world clock](https://tukuk.org/maps/clock) and the [sky map](https://tukuk.org/maps/sky).
