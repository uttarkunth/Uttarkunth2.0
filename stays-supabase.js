/* Uttarkunth Stays: read published listing data without replacing the existing design.
   If the API is unavailable, the existing HTML card remains as the fallback. */
(function () {
  "use strict";

  var endpoint = "/.netlify/functions/properties";
  var cardSelector = '#props .prop[href="#/stays-yash"]';

  function updateExistingCard(property) {
    var card = document.querySelector(cardSelector);
    if (!card || !property) return;

    var title = card.querySelector(".pi h3");
    var description = card.querySelector(".pi p");

    if (title && property.name) {
      title.textContent = property.name;
    }

    if (description) {
      var village = property.village || property.address || "";
      var district = property.district || "";
      var location = [village, district].filter(Boolean).join(", ");
      description.textContent = location
        ? location + ". Stay inside the landscape."
        : "Stay inside the landscape.";
    }

    card.setAttribute("data-supabase-property-id", property.id || "");
    card.setAttribute("data-listing-source", "supabase");
  }

  function loadPublishedProperties() {
    fetch(endpoint, {
      method: "GET",
      headers: { "Accept": "application/json" },
      cache: "no-store"
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Property API returned " + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data || data.ok !== true || !Array.isArray(data.properties)) return;
        var yash = data.properties.find(function (property) {
          return property.slug === "yash-home-stay";
        });
        if (yash) updateExistingCard(yash);
      })
      .catch(function (error) {
        // Keep the original, hardcoded card visible if the API cannot be reached.
        console.warn("Uttarkunth Stays: using the existing listing fallback.", error);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadPublishedProperties, { once: true });
  } else {
    loadPublishedProperties();
  }
})();
