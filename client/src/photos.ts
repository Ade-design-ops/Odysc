// Free-to-use photos from Pexels (https://www.pexels.com/license/ — no attribution required,
// credited in the footer anyway). Loaded from Pexels' CDN at runtime.
// To use your own USC photos instead: drop files in client/public/photos/ and point these at
// "/photos/your-file.jpg".

const px = (id: number, w = 1600) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${w}`;

export const PHOTOS = {
  hero: px(7973200, 2000), // two students talking in front of a brick building
  group: px(7972533), // three friends chatting on campus
  steps: px(7972488), // two students on brick steps
  chat: px(7973027, 900), // two students laughing
};
