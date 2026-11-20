import { describe, expect, it } from "vitest";
import { callingFieldsFromBody, mergeCallingFields } from "./leadFields";

describe("callingFieldsFromBody", () => {
  it("extracts the string fields trimmed and the hours as numbers", () => {
    const result = callingFieldsFromBody({
      city: " Daytona Beach ",
      state: "FL",
      timezone: "America/New_York",
      bestStartHour: "9",
      bestEndHour: 11,
      painPoints: "Slow mobile site.",
      hook: "Scored 24 out of 100.",
      ignored: "not a calling field",
    });
    expect(result).toEqual({
      fields: {
        city: "Daytona Beach",
        state: "FL",
        timezone: "America/New_York",
        bestStartHour: 9,
        bestEndHour: 11,
        painPoints: "Slow mobile site.",
        hook: "Scored 24 out of 100.",
      },
    });
  });

  it("extracts the name pronunciation respelling, trimmed", () => {
    expect(callingFieldsFromBody({ namePronunciation: " LEN-erd duh-ZEER " })).toEqual({
      fields: { namePronunciation: "LEN-erd duh-ZEER" },
    });
    expect(callingFieldsFromBody({ namePronunciation: 42 })).toEqual({
      error: "namePronunciation must be text",
    });
  });

  it("accepts a fractional start hour for early morning windows", () => {
    expect(callingFieldsFromBody({ bestStartHour: 7.5 })).toEqual({
      fields: { bestStartHour: 7.5 },
    });
  });

  it("rejects a bad timezone and an out of range hour", () => {
    expect(callingFieldsFromBody({ timezone: "Eastern Time" })).toEqual({
      error: "timezone must be an IANA timezone name, for example America/New_York",
    });
    expect(callingFieldsFromBody({ bestEndHour: 25 })).toEqual({
      error: "bestEndHour must be an hour between 0 and 24",
    });
  });

  it("marks an emptied hour for clearing", () => {
    expect(callingFieldsFromBody({ bestStartHour: "" })).toEqual({
      fields: { bestStartHour: "" },
    });
  });
});

describe("mergeCallingFields", () => {
  it("overwrites provided keys, clears empty ones, and leaves the rest alone", () => {
    const merged = mergeCallingFields(
      { phone: "+1 555 010 2030", city: "Old Town", hook: "Old hook.", bestStartHour: 9 },
      { city: "Daytona Beach", hook: "", bestStartHour: 8 },
    );
    expect(merged).toEqual({ phone: "+1 555 010 2030", city: "Daytona Beach", bestStartHour: 8 });
  });
});
