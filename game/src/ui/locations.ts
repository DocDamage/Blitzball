/**
 * locations.ts - Where each of the 60 recruitable players is found in Spira.
 *
 * Flavour text for the scout screen; indexed by data player id. Team players
 * are listed at their home town, free agents where the original game lets
 * you recruit them. Pure data, no game effect.
 */

const LOCATIONS: readonly (readonly [number, string, string])[] = [
  [0, "Besaid Island", "Star player of the Aurochs; permanently signed."],
  [1, "Besaid Island", "Captain and coach of the Aurochs, a Luca legend in his own mind."],
  [2, "Besaid Island", "Fastest swimmer on Besaid's beach."],
  [3, "Besaid Island", "Aurochs midfield thinker; good passer."],
  [4, "Besaid Island", "Quiet Aurochs defender with a solid tackle."],
  [5, "Besaid Island", "Aurochs forward who never stops talking."],
  [6, "Besaid Island", "The Aurochs' round goalkeeper; braver than he looks."],
  [7, "Luca Stadium", "Goers captain, loud and skilful."],
  [8, "Luca Stadium", "Goers forward with a lethal shot."],
  [9, "Luca Stadium", "Goers midfield general."],
  [10, "Luca Stadium", "Goers defender, always in the right place."],
  [11, "Luca Stadium", "Goers defender; strong tackler."],
  [12, "Luca Stadium", "Goers keeper with quick reflexes."],
  [13, "Kilika Port", "Beasts forward who shoots from anywhere."],
  [14, "Kilika Port", "Beasts midfielder; steady passer."],
  [15, "Kilika Port", "Beasts forward with a surprising burst of speed."],
  [16, "Kilika Port", "Beasts defender; hard to get past."],
  [17, "Kilika Port", "Beasts defender with a long reach."],
  [18, "Kilika Port", "Beasts goalkeeper; calm under pressure."],
  [19, "Bikanel Island", "Psyches forward with a cannon of a shot."],
  [20, "Bikanel Island", "Psyches forward who loves a trick."],
  [21, "Bikanel Island", "Psyches midfield engine."],
  [22, "Bikanel Island", "Psyches defender; technical and tidy."],
  [23, "Bikanel Island", "Psyches defender with a fierce tackle."],
  [24, "Bikanel Island", "The best goalkeeper in Spira, if you can keep him."],
  [25, "Mt. Gagazet", "Fangs forward; raw power."],
  [26, "Mt. Gagazet", "Fangs forward; a strong shot."],
  [27, "Mt. Gagazet", "Fangs midfielder who tackles everything."],
  [28, "Mt. Gagazet", "Fangs defender; immovable."],
  [29, "Mt. Gagazet", "Fangs defender; tireless."],
  [30, "Mt. Gagazet", "Fangs goalkeeper; huge and patient."],
  [31, "Guadosalam", "Glories forward; graceful and quick."],
  [32, "Guadosalam", "Glories forward with precise shooting."],
  [33, "Guadosalam", "Glories midfielder; superb passing."],
  [34, "Guadosalam", "Glories defender; reads the game well."],
  [35, "Guadosalam", "Glories defender; elegant tackler."],
  [36, "Guadosalam", "Glories goalkeeper with long arms."],
  [37, "Mi'ihen Highroad", "Travel agency owner who still finds time to play."],
  [38, "Kilika Port", "Sits by the Kilika docks waiting for a contract."],
  [39, "Kilika Port", "A Kilika woodsman turned keeper."],
  [40, "Kilika Port", "Found on the Kilika forest path."],
  [41, "Luca Stadium", "A child prodigy from the Luca stands."],
  [42, "Luca Stadium", "Former Crusader; found near the Luca docks."],
  [43, "Luca Stadium", "Biggs' partner; always nearby."],
  [44, "Mi'ihen Highroad", "A chocobo rider at the Highroad agency."],
  [45, "Lake Macalania", "Works at the Macalania travel agency."],
  [46, "Moonflow", "Wanders the Moonflow's north bank."],
  [47, "Luca Stadium", "Luca docks; a cheap but solid pick."],
  [48, "Lake Macalania", "An Al Bhed engineer by the Macalania woods."],
  [49, "Mushroom Rock Road", "A Crusader stationed at Mushroom Rock."],
  [50, "Mi'ihen Highroad", "Luca's fast midfielder, found on the Highroad."],
  [51, "Thunder Plains", "Braves the lightning at the Thunder Plains agency."],
  [52, "Besaid Village", "A Besaid villager and reliable keeper."],
  [53, "Kilika Port", "Grew up on the Kilika waterfront."],
  [54, "Mt. Gagazet", "A Ronso at the Gagazet gate."],
  [55, "Guadosalam", "Stands by the Guadosalam inn."],
  [56, "Luca Stadium", "A Luca local with an unusually strong tackle."],
  [57, "Bikanel Island", "Rikku's brother; found at the Al Bhed Home / airship."],
  [58, "Luca Stadium", "One of the Luca stadium staff; a quick learner."],
  [59, "Djose Temple", "Keeps the Djose docks tidy between games."],
];

const BY_ID = new Map(LOCATIONS.map(([id, place, note]) => [id, { place, note }]));

export interface Location {
  place: string;
  note: string;
}

export function locationOf(playerId: number): Location {
  return BY_ID.get(playerId) ?? { place: "Unknown", note: "Whereabouts unknown." };
}
