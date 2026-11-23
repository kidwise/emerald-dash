[out:json][timeout:90];
(
  way["highway"~"^(trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian|service|trunk_link|primary_link|secondary_link|tertiary_link|motorway|motorway_link)$"](47.6160,-122.3450,47.6300,-122.3295);
  way["building"](47.6160,-122.3450,47.6300,-122.3295);
  relation["building"](47.6160,-122.3450,47.6300,-122.3295);
  way["natural"="water"](47.6160,-122.3450,47.6320,-122.3295);
  relation["natural"="water"](47.6160,-122.3450,47.6320,-122.3295);
  way["leisure"="park"](47.6160,-122.3450,47.6300,-122.3295);
  way["railway"="tram"](47.6160,-122.3450,47.6300,-122.3295);
);
out body geom;
