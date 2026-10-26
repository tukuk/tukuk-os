SLUG: how-turn-by-turn-navigation-works
TITLE: How Turn-by-Turn Navigation Works — From Map Data to "Turn Left in 200 Metres"
EXCERPT: Every route you have ever followed came from the same pipeline: a giant graph of roads, a search for the cheapest path through it, and a translation layer that turns geometry into human instructions. Here is each step, in plain language.
TAGS: navigation, maps, openstreetmap, routing, technology

## A Map Is Actually a Graph

Digital maps stop being a picture and start being mathematics the moment you ask "how do I get there?" The road network is stored as a **graph**: every junction is a node, every road segment between two junctions is an edge, and every edge carries costs — length, speed limit, road class, turn restrictions. A city like London is a graph of a few million edges; the whole planet, in OpenStreetMap, is hundreds of millions.

Finding a route then becomes a search problem: what is the cheapest chain of edges between node A and node B? The classic answer is Dijkstra's algorithm — explore outward from A, always expanding the currently cheapest candidate, until you hit B. Naive Dijkstra on a planet-scale graph is far too slow for a phone, which is why modern engines (OSRM, Valhalla, RoutingEngine) preprocess the graph with tricks like **contraction hierarchies**: collapse quiet residential nodes into shortcuts ahead of time, so the live search hops along motorways the way your eyes skip over back streets.

## The Three Calls Behind Every "Go"

What looks like one action — tap two addresses, get a route — is really three separate services:

1. **Geocoding** turns the text "Brandenburg Gate" into a coordinate. A geocoder parses the query, looks it up in a gazetteer (a dictionary of places), and snaps the result to the nearest address point. OpenStreetMap's gazetteer is Nominatim; it is good, free, and politely rate-limited.
2. **Routing** snaps both coordinates onto the nearest road nodes and runs the graph search, returning not a picture but a *list of edges with directions*: which road, which manoeuvre, which distance.
3. **Rendering** draws the polyline on tiles and converts the manoeuvre list into language — "merge left", "take the roundabout and exit at the second outlet". The instruction you hear was generated from a machine tag called a maneuver type.

## Why Routes Can Be "Impossible"

If two points sit on disconnected parts of the graph — an island and a mainland, or the two halves of a country divided by sea — the search simply never reaches the target. Good routers say so explicitly instead of inventing a route; OSRM answers "Impossible route between points". Map engines that hide the graph from you may fall back to a straight line and let you discover the water yourself. A navigator that admits it cannot get there is doing its job honestly.

## What Live Routing Does Not Know

A free graph router knows the road network, not tonight's crash on it. Commercial apps fold in live congestion (from counting the phones crawling along each edge) and personalised ETA models; open routers like OSRM compute static travel-time routes and stay refreshingly predictable because of it. That is also why the same route can be suggested to everyone at 3 a.m. and at 5 p.m. — the maths does not care, only the traffic layer does.

## Try It Yourself

Our own free route planner, [Maps & Navigation](https://tukuk.org/maps), runs exactly this pipeline: Nominatim for place lookup, OSRM for driving, cycling and walking routes, and the step list rendered from OSRM manoeuvre tags — no account, no key, nothing tracked. Compare a driving and a walking route between the same two pins and you can watch the graph costs change: the same edges, very different prices.
