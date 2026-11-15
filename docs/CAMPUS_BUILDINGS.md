# Campus building catalog

The event dropdown contains 31 curated University Park campus buildings, expanded from the original eight. Entries are sorted by USC code. The same server-safe catalog in [campus-buildings.ts](../backend/src/campus-buildings.ts) supplies browser maps/dropdowns and backend event validation; unknown and inherited-property codes are rejected. This is a supported subset of USC buildings.

Codes and building identities were checked on November 15, 2026 against USC Facilities' [January 2026 University Park map](https://fpm.usc.edu/wp-content/uploads/2026/01/UPC_BaseMapGrid_36x48_20260116.pdf). The current GCS and DMC labels are also supported by [Computer Science directions](https://www.cs.usc.edu/visiting/directions-maps/) and [Dornsife contact information](https://dornsife.usc.edu/poir/contact-us/).

New coordinates were derived from the named OpenStreetMap building footprints below, choosing a roof-interior point outside courtyard holes and verifying it against the actual OpenFreeMap building geometry used by the app. These coordinates position map pins; they are not surveyed entrances. OpenStreetMap geometry is © OpenStreetMap contributors, ODbL.

## Additional locations

| Code | Building | Named footprint | Map anchor (latitude, longitude) |
| --- | --- | --- | --- |
| ACC | Leventhal School of Accounting | [OSM way 154906767](https://www.openstreetmap.org/way/154906767) | 34.0191668, -118.2855889 |
| ADM | Bovard Administration Building | [OSM way 406923885](https://www.openstreetmap.org/way/406923885) | 34.0209688, -118.2855659 |
| ANN | Wallis Annenberg Hall | [OSM way 406923961](https://www.openstreetmap.org/way/406923961) | 34.0208072, -118.2870045 |
| ASC | Annenberg School for Communication | [OSM way 406923882](https://www.openstreetmap.org/way/406923882) | 34.0221085, -118.286371 |
| DMC | Joseph Medicine Crow Center | [OSM relation 6095465](https://www.openstreetmap.org/relation/6095465) | 34.0213736, -118.2841907 |
| GCS | Ginsburg Hall | [OSM way 1340874365](https://www.openstreetmap.org/way/1340874365) | 34.0219019, -118.2906016 |
| GER | Ethel Percy Andrus Gerontology Center | [OSM relation 6095455](https://www.openstreetmap.org/relation/6095455) | 34.0203595, -118.290432 |
| GFS | Grace Ford Salvatori Hall | [OSM way 406923897](https://www.openstreetmap.org/way/406923897) | 34.0212301, -118.2878574 |
| HOH | Hoffman Hall of Business Administration | [OSM way 43332199](https://www.openstreetmap.org/way/43332199) | 34.0187409, -118.2852419 |
| JFF | Jill and Frank Fertitta Hall | [OSM way 430431424](https://www.openstreetmap.org/way/430431424) | 34.0187843, -118.2824269 |
| KAP | Kaprielian Hall | [OSM way 406923906](https://www.openstreetmap.org/way/406923906) | 34.0225398, -118.291024 |
| KDC | Glorya Kaufman International Dance Center | [OSM way 154906707](https://www.openstreetmap.org/way/154906707) | 34.023562, -118.2852394 |
| LAW | Musick Law Building | [OSM way 43332198](https://www.openstreetmap.org/way/43332198) | 34.018742, -118.2845353 |
| MHP | Mudd Hall of Philosophy | [OSM relation 6095464](https://www.openstreetmap.org/relation/6095464) | 34.0188047, -118.2868148 |
| OHE | Olin Hall of Engineering | [OSM relation 1905843](https://www.openstreetmap.org/relation/1905843) | 34.0209322, -118.2894613 |
| SLH | Stauffer Science Lecture Hall | [OSM way 442277367](https://www.openstreetmap.org/way/442277367) | 34.0195645, -118.287624 |
| SSC | Frank R. Seaver Science Center | [OSM way 406923894](https://www.openstreetmap.org/way/406923894) | 34.019777, -118.2892117 |
| STU | Gwynn Wilson Student Union | [OSM relation 6095474](https://www.openstreetmap.org/relation/6095474) | 34.0202396, -118.2856406 |
| TGF | Town and Gown | [OSM way 154906675](https://www.openstreetmap.org/way/154906675) | 34.0191076, -118.2842802 |
| VPD | Verna and Peter Dauterive Hall | [OSM way 277176270](https://www.openstreetmap.org/way/277176270) | 34.0189139, -118.2838698 |
| WAH | Watt Hall of Architecture and Fine Arts | [OSM way 406923925](https://www.openstreetmap.org/way/406923925) | 34.0191671, -118.288003 |
| WPH | Waite Phillips Hall of Education | [OSM way 406923958](https://www.openstreetmap.org/way/406923958) | 34.0219557, -118.2838254 |
| ZHS | James H. Zumberge Hall of Science | [OSM relation 6095466](https://www.openstreetmap.org/relation/6095466) | 34.0191554, -118.2864424 |

## Verification

All 31 anchors were checked against the cached public OpenFreeMap source tile used for this campus, including the geographic component selection and preservation of unrelated grouped buildings. Each of the 23 new anchors was also checked inside its independently named OSM polygon. Existing original coordinates were retained, including the corrected SCA roof anchor. Map behavior was visually checked at representative new locations; geometry checks cover the full catalog.

To add another supported location, verify its current USC code/name and named footprint, choose a point inside the roof rather than a courtyard, add it to the shared catalog in code order, then check the map and event create/edit validation.
