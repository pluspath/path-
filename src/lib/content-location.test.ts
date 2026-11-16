import { describe, expect, test } from "bun:test";
import {
  buildLocationLabel,
  commentLocationColumns,
  parseIncomingLocation,
  publicLocationFromRow,
} from "./content-location";

describe("parseIncomingLocation", () => {
  test("requires explicit share", () => {
    expect(parseIncomingLocation({ city: "Riyadh", lat: 24.7, lng: 46.7 })).toBeNull();
  });

  test("accepts shared city/country", () => {
    const loc = parseIncomingLocation({
      share: true,
      city: "Riyadh",
      country: "Saudi Arabia",
    });
    expect(loc?.label).toBe("Riyadh, Saudi Arabia");
    expect(loc?.share).toBe(true);
  });

  test("comment columns never inherit moment fields", () => {
    const loc = parseIncomingLocation({
      share: true,
      city: "Jeddah",
      country: "Saudi Arabia",
      lat: 21.5,
      lng: 39.2,
    });
    const cols = commentLocationColumns(loc);
    expect(cols.location_city).toBe("Jeddah");
    expect(cols.location_shared).toBe(true);
    expect(commentLocationColumns(null).location_shared).toBe(false);
  });
});

describe("publicLocationFromRow", () => {
  test("omits coordinates", () => {
    const pub = publicLocationFromRow({
      location_shared: true,
      location_label: "Riyadh, Saudi Arabia",
      location_city: "Riyadh",
      location_lat: 24.7,
      location_lng: 46.7,
    });
    expect(pub.locationLabel).toBe("Riyadh, Saudi Arabia");
    expect((pub as any).locationLat).toBeUndefined();
    expect((pub as any).locationLng).toBeUndefined();
  });
});

describe("buildLocationLabel", () => {
  test("prefers explicit label", () => {
    expect(buildLocationLabel({ label: "Home", city: "X" })).toBe("Home");
  });
});
