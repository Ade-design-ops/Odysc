import { Type } from '@sinclair/typebox';
import { academicYears, type Profile } from './models.js';

export const academicYearSchema = Type.Union([
  ...academicYears.map(year => Type.Literal(year)), Type.Null(),
]);
export const tagList = (maxItems: number, maxLength = 100) => Type.Array(Type.String({ maxLength }), { maxItems });
export const profileBody = Type.Object({
  major: Type.String({ maxLength: 150 }),
  academicYear: Type.Optional(academicYearSchema),
  graduationYear: Type.Union([Type.Integer({ minimum: 2000, maximum: 2100 }), Type.Null()]),
  bio: Type.String({ maxLength: 1500 }),
  interests: tagList(20),
  skills: tagList(30),
  experience: Type.String({ maxLength: 4000 }),
  goals: Type.Optional(tagList(10, 300)),
}, { additionalProperties: false });

export function cleanTags(items: string[]): string[] {
  const seen = new Set<string>();
  return items.map(item => item.trim()).filter(item => {
    const key = item.toLocaleLowerCase('en-US');
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function normalizeProfile(profile: Profile): Profile {
  return {
    ...profile,
    major: profile.major.trim(), bio: profile.bio.trim(), experience: profile.experience.trim(),
    interests: cleanTags(profile.interests), skills: cleanTags(profile.skills), goals: cleanTags(profile.goals),
  };
}
