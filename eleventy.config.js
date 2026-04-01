module.exports = function(eleventyConfig) {
  // Pass through existing HTML pages and assets as-is
  eleventyConfig.addPassthroughCopy("*.html");
  eleventyConfig.addPassthroughCopy("*.png");
  eleventyConfig.addPassthroughCopy("*.pdf");
  eleventyConfig.addPassthroughCopy("admin");

  return {
    dir: {
      input: ".",
      output: "_site",
      includes: "_includes",
      layouts: "_layouts"
    }
  };
};
