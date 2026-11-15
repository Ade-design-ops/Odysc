import { MAX_RESUME_BYTES, MAX_RESUME_PAGES } from './resume.js';

// Frontend copy and input requirements come from the same endpoint as the draft.
export const onboardingFields = [
  { key: 'name', label: 'Full name', type: 'text', required: true, helperText: 'Use the name you would like clubs to see on your applications.', maxLength: 100 },
  { key: 'academicYear', label: 'Year of study', type: 'select', required: true, helperText: 'Tell us where you are in your studies.', options: [
    { value: 'first_year', label: 'First year' }, { value: 'second_year', label: 'Second year' },
    { value: 'third_year', label: 'Third year' }, { value: 'fourth_year', label: 'Fourth year' },
    { value: 'fifth_year_plus', label: 'Fifth year or beyond' }, { value: 'graduate', label: 'Graduate student' },
    { value: 'other', label: 'Other' },
  ] },
  { key: 'major', label: 'Major', type: 'text', required: true, helperText: 'Undeclared is welcome. You can update this later.', maxLength: 150 },
  { key: 'interests', label: 'What are you interested in?', type: 'tags', required: true, minItems: 1, maxItems: 20, maxItemLength: 100, helperText: 'Choose at least one interest to help us find clubs to explore. Still figuring it out? Choose Still exploring.', suggestions: ['Technology', 'Design', 'Music', 'Community service', 'Sports', 'Entrepreneurship', 'Still exploring'] },
  { key: 'resume', label: 'Résumé', type: 'file', required: false, helperText: 'Optional. Add your résumé so your background can help with club matches and future applications. You can add one later.', accept: ['application/pdf'], maxBytes: MAX_RESUME_BYTES, maxPages: MAX_RESUME_PAGES },
  { key: 'goals', label: 'What would you like to get out of joining a club?', type: 'tags', required: false, maxItems: 10, maxItemLength: 300, helperText: 'Optional. Share what you hope to find so we can look for relevant opportunities.', suggestions: ['Make friends', 'Explore interests', 'Develop career skills', 'Serve the community', 'Try leadership'] },
  { key: 'bio', label: 'A little about you', type: 'textarea', required: false, maxLength: 1500, helperText: 'Optional. A few sentences can help introduce you when you apply. No previous club experience needed.' },
  { key: 'skills', label: 'Skills you would like to share', type: 'tags', required: false, maxItems: 30, maxItemLength: 100, helperText: 'Optional. Add things you know or enjoy doing, such as coding, writing, organizing, or public speaking.' },
];
