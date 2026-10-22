
/* Uttarkunth Stays: load live property data from Supabase */
(function () {
  "use strict";

  var endpoint = "/.netlify/functions/properties";

  function locationText(property) {
    return [property.village, property.district, property.state]
      .filter(Boolean).join(", ");
  }

  function firstRoom(property) {
    return Array.isArray(property.rooms) ? property.rooms[0] : null;
  }

  function addRoomPrice(info, room) {
    if (!room || !info) return;

    var price = info.querySelector(".supabase-room-price");
    if (!price) {
      price = document.createElement("p");
      price.className = "supabase-room-price";
      var link = info.querySelector(".lnk");
      info.insertBefore(price, link || null);
    }

    price.textContent = room.room_name + " · Up to " +
      room.max_guests + " guests · ₹" +
      Number(room.base_price).toLocaleString("en-IN") + " / night";
  }

  function updateYash(property) {
    var card = document.querySelector('#props .prop[href="#/stays-yash"]');
    if (!card) return;

    var title = card.querySelector(".pi h3");
    var description = card.querySelector(".pi p");
    var image = card.querySelector(".ph img");

    if (title) title.textContent = property.name;
    if (description) description.textContent =
      locationText(property) + ". Stay inside the landscape.";

    if (image && property.photos && property.photos[0]) {
      image.src = property.photos[0];
      image.removeAttribute("data-from");
    }

    addRoomPrice(card.querySelector(".pi"), firstRoom(property));
    card.setAttribute("data-supabase-property-id", property.id || "");
  }

  function addWonderway(property) {
    var grid = document.querySelector("#props .pg");
    if (!grid || grid.querySelector('[data-property-slug="wonderway-retreat"]')) return;

    var card = document.createElement("a");
    card.className = "prop rv";
    card.href = "https://www.booking.com/hotel/in/wonderway-retreat-jari.hi.html";
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.setAttribute("data-property-slug", "wonderway-retreat");
    card.setAttribute("data-supabase-property-id", property.id || "");

    var photoBox = document.createElement("div");
    photoBox.className = "ph";

    if (property.photos && property.photos[0]) {
      var image = document.createElement("img");
      image.src = property.photos[0];
      image.alt = property.name;
      image.loading = "lazy";
      photoBox.appendChild(image);
    }

    var info = document.createElement("div");
    info.className = "pi";

    var label = document.createElement("small");
    label.textContent = "Stay in Jari";

    var title = document.createElement("h3");
    title.textContent = property.name;

    var description = document.createElement("p");
    description.textContent = locationText(property) +
      ". A peaceful mountain stay.";

    info.appendChild(label);
    info.appendChild(title);
    info.appendChild(description);
    addRoomPrice(info, firstRoom(property));

    var link = document.createElement("span");
    link.className = "lnk";
    link.textContent = "View this stay →";
    info.appendChild(link);

    card.appendChild(photoBox);
    card.appendChild(info);

    var placeholder = grid.querySelector(".prop.soon");
    grid.insertBefore(card, placeholder || null);
  }

  function loadProperties() {
    fetch(endpoint, {
      headers: { "Accept": "application/json" },
      cache: "no-store"
    })
      .then(function (response) {
        if (!response.ok) throw new Error("API returned " + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data || !data.ok || !Array.isArray(data.properties)) return;

        data.properties.forEach(function (property) {
          if (property.slug === "yash-home-stay") updateYash(property);
          if (property.slug === "wonderway-retreat") addWonderway(property);
        });
      })
      .catch(function (error) {
        console.warn("Uttarkunth Stays: using existing listing fallback.", error);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadProperties, { once: true });
  } else {
    loadProperties();
  }
})();
