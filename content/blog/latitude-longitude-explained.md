SLUG: latitude-longitude-explained
TITLE: Latitude and Longitude Explained — How Every Point on Earth Gets an Address
EXCERPT: Two numbers, a sphere, and four centuries of arguments about where Greenwich should be. The coordinate system you use every day without thinking, demystified.
TAGS: geography, coordinates, maps, education, world data

## The Idea in One Paragraph

Wrap the Earth in an imaginary cage of lines: circles running east-west (**parallels of latitude**) and half-circles running pole to pole (**meridians of longitude**). Any place on the surface is where one line from each family crosses, and the pair of line-numbers is its address. Latitude runs 0° at the equator to 90° at the poles, north or south. Longitude runs 0° at the prime meridian to 180° east or west — meeting again on the far side of the planet, which is exactly why the International Date Line sits there.

## Why a Degree Is About 111 Kilometres

The Earth's meridional circumference is roughly 40,000 km, and a meridian is a full 360° — so one degree of latitude is 40,000 ÷ 360 ≈ **111 km**, everywhere, always. That constant was no accident: the metre was originally defined as one ten-millionth of the distance from equator to pole. Longitude degrees are 111 km only at the equator; the parallels shrink as cos(latitude), so a degree of longitude in Norway covers barely half that, and at the poles it covers nothing at all — all meridians meet at a single point.

## Minutes, Seconds, and Decimal Digits

Navigators subdivided each degree into 60 **minutes** and each minute into 60 **seconds** (so one arc-minute of latitude ≈ 1.85 km — exactly the nautical mile — and one arc-second ≈ 31 m) — sexagesimal accounting inherited from Babylon, which is also why circles have 360 degrees. Modern systems just write decimals: 5 decimal places is about 1.1 m, plenty to park a car on a coordinate. If two numbers differ by 0.001°, the places are roughly 111 metres apart at the equator — a useful gut-calibration when reading coordinates.

## Why Longitude Took So Long to Get Right

Latitude is easy: measure the noon height of the Sun or the pole star and consult a table. Longitude requires knowing *what time it is somewhere else* — the reason "longitude clocks" (marine chronometers) made John Harrison famous and why navigators kept sailing into cliffs. The prime meridian itself is pure convention: every nation's mapmaker used their own capital until the 1884 conference picked Greenwich, largely because most world charts were already drawn there by British shipbuilders. When you enter a coordinate today, you are using an agreement that is only about 140 years old — and coordinates you see online are almost always in the WGS84 reference frame, the ellipsoid GPS runs on, which differs from older local maps by anything from a few metres to over a kilometre.

## Try It Yourself

On our [route planner](/maps) every search result returns its latitude and longitude, and the two boxes accept raw coordinates directly — paste any pair and press Go. Look up your own home, then your country's capital, and compute the rough north-south distance from the latitude difference alone (×111 km). It works better than most people expect, and it is the same arithmetic that let sailors estimate home. For the cast of characters living at each coordinate, the [World Cities](/cities) profiles show where the great cities actually sit.
