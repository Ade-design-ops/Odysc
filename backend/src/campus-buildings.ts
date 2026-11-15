// Curated University Park campus locations shared by event validation and the UI.
// Codes/names: USC Facilities' January 2026 campus map.
// Roof-interior anchors: OpenStreetMap footprints (© OpenStreetMap contributors, ODbL).
// https://fpm.usc.edu/wp-content/uploads/2026/01/UPC_BaseMapGrid_36x48_20260116.pdf
// See docs/CAMPUS_BUILDINGS.md for sources and verification scope.

export interface Building {
  code: string;
  name: string;
  lat: number;
  lng: number;
}

export const BUILDINGS: Record<string, Building> = {
  // https://www.openstreetmap.org/way/154906767
  ACC: { code: "ACC", name: "Leventhal School of Accounting", lat: 34.0191668, lng: -118.2855889 },
  // https://www.openstreetmap.org/way/406923885
  ADM: { code: "ADM", name: "Bovard Administration Building", lat: 34.0209688, lng: -118.2855659 },
  // https://www.openstreetmap.org/way/406923961
  ANN: { code: "ANN", name: "Wallis Annenberg Hall", lat: 34.0208072, lng: -118.2870045 },
  // https://www.openstreetmap.org/way/406923882
  ASC: { code: "ASC", name: "Annenberg School for Communication", lat: 34.0221085, lng: -118.286371 },
  // https://www.openstreetmap.org/relation/6095465
  DMC: { code: "DMC", name: "Joseph Medicine Crow Center", lat: 34.0213736, lng: -118.2841907 },
  DML: { code: "DML", name: "Doheny Memorial Library", lat: 34.020163, lng: -118.283741 },
  // https://www.openstreetmap.org/way/1340874365
  GCS: { code: "GCS", name: "Ginsburg Hall", lat: 34.0219019, lng: -118.2906016 },
  // https://www.openstreetmap.org/relation/6095455
  GER: { code: "GER", name: "Ethel Percy Andrus Gerontology Center", lat: 34.0203595, lng: -118.290432 },
  // https://www.openstreetmap.org/way/406923897
  GFS: { code: "GFS", name: "Grace Ford Salvatori Hall", lat: 34.0212301, lng: -118.2878574 },
  // https://www.openstreetmap.org/way/43332199
  HOH: { code: "HOH", name: "Hoffman Hall of Business Administration", lat: 34.0187409, lng: -118.2852419 },
  // https://www.openstreetmap.org/way/430431424
  JFF: { code: "JFF", name: "Jill and Frank Fertitta Hall", lat: 34.0187843, lng: -118.2824269 },
  // https://www.openstreetmap.org/way/406923906
  KAP: { code: "KAP", name: "Kaprielian Hall", lat: 34.0225398, lng: -118.291024 },
  // https://www.openstreetmap.org/way/154906707
  KDC: { code: "KDC", name: "Glorya Kaufman International Dance Center", lat: 34.023562, lng: -118.2852394 },
  // https://www.openstreetmap.org/way/43332198
  LAW: { code: "LAW", name: "Musick Law Building", lat: 34.018742, lng: -118.2845353 },
  LVL: { code: "LVL", name: "Leavey Library", lat: 34.021785, lng: -118.28294 },
  // https://www.openstreetmap.org/relation/6095464
  MHP: { code: "MHP", name: "Mudd Hall of Philosophy", lat: 34.0188047, lng: -118.2868148 },
  // https://www.openstreetmap.org/relation/1905843
  OHE: { code: "OHE", name: "Olin Hall of Engineering", lat: 34.0209322, lng: -118.2894613 },
  RTH: { code: "RTH", name: "Ronald Tutor Hall", lat: 34.020087, lng: -118.289835 },
  SAL: { code: "SAL", name: "Salvatori Computer Science Center", lat: 34.019485, lng: -118.289513 },
  // https://www.openstreetmap.org/way/406923930
  SCA: { code: "SCA", name: "School of Cinematic Arts", lat: 34.0232273, lng: -118.2862434 },
  SGM: { code: "SGM", name: "Seeley G. Mudd Building", lat: 34.021507, lng: -118.288944 },
  // https://www.openstreetmap.org/way/442277367
  SLH: { code: "SLH", name: "Stauffer Science Lecture Hall", lat: 34.0195645, lng: -118.287624 },
  // https://www.openstreetmap.org/way/406923894
  SSC: { code: "SSC", name: "Frank R. Seaver Science Center", lat: 34.019777, lng: -118.2892117 },
  // https://www.openstreetmap.org/relation/6095474
  STU: { code: "STU", name: "Gwynn Wilson Student Union", lat: 34.0202396, lng: -118.2856406 },
  TCC: { code: "TCC", name: "Ronald Tutor Campus Center", lat: 34.020397, lng: -118.286346 },
  // https://www.openstreetmap.org/way/154906675
  TGF: { code: "TGF", name: "Town and Gown", lat: 34.0191076, lng: -118.2842802 },
  THH: { code: "THH", name: "Taper Hall", lat: 34.022229, lng: -118.284616 },
  // https://www.openstreetmap.org/way/277176270
  VPD: { code: "VPD", name: "Verna and Peter Dauterive Hall", lat: 34.0189139, lng: -118.2838698 },
  // https://www.openstreetmap.org/way/406923925
  WAH: { code: "WAH", name: "Watt Hall of Architecture and Fine Arts", lat: 34.0191671, lng: -118.288003 },
  // https://www.openstreetmap.org/way/406923958
  WPH: { code: "WPH", name: "Waite Phillips Hall of Education", lat: 34.0219557, lng: -118.2838254 },
  // https://www.openstreetmap.org/relation/6095466
  ZHS: { code: "ZHS", name: "James H. Zumberge Hall of Science", lat: 34.0191554, lng: -118.2864424 },
};
