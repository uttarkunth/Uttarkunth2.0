/* Uttarkunth Stays: live property cards and room details from Supabase.
   Property and room information is read from the API; existing page design remains the fallback. */
(function () {
  "use strict";

  var endpoint = "/.netlify/functions/properties";
  var wonderwayWhatsApp = "https://wa.me/918580553313";
  var latestProperties = [];

  function locationText(property) {
    return [property.village, property.district, property.state]
      .filter(Boolean).join(", ");
  }

  function money(value) {
    return "₹" + Number(value || 0).toLocaleString("en-IN");
  }

  function makeWhatsAppUrl(property, room) {
    var message = "Hello " + (property.name || "Wonderway Retreat") +
      "! I found your property on Uttarkunth Stays and would like to enquire about a booking.\n\n" +
      "My booking details:\n" +
      "Check-in date: [DD/MM/YYYY]\n" +
      "Check-out date: [DD/MM/YYYY]\n" +
      "Number of guests: [adults and children]\n" +
      "Room requested: " + (room ? room.room_name : "[room type]") + "\n\n" +
      (room ? "I saw the listed base rate of " + money(room.base_price) +
        " per night for up to " + room.max_guests + " guests. Please confirm the current rate and total cost for my dates.\n\n" : "") +
      "Could you please confirm whether the room is available for these dates? If it is unavailable, please suggest the nearest available alternative dates.\n\n" +
      "Please also share the amenities and facilities available, including Wi-Fi, parking, meals, kitchenette, private bathroom, check-in/check-out timings, and any extra charges (where applicable). Kindly let me know what is included in the room rate.\n\n" +
      "Thank you!";
    return wonderwayWhatsApp + "?text=" + encodeURIComponent(message);
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
    price.textContent = room.room_name + " · Up to " + room.max_guests +
      " guests · " + money(room.base_price) + " / night";
  }

  function updateYash(property) {
    var card = document.querySelector('#props .prop[href="#/stays-yash"]');
    if (!card) return;

    var title = card.querySelector(".pi h3");
    var description = card.querySelector(".pi p");
    var image = card.querySelector(".ph img");

    if (title) title.textContent = property.name || "Yash Home Stay";
    if (description) description.textContent =
      locationText(property) + ". Stay inside the landscape.";

    if (image && Array.isArray(property.photos) && property.photos[0]) {
      // Keep the existing card image visible even if the first stored photo URL fails.
      image.removeAttribute("data-from");
      image.loading = "lazy";
      image.style.width = "100%";
      image.style.height = "100%";
      image.style.objectFit = "cover";
      image.onerror = function () {
        var fallback = (property.photos || []).find(function (url) {
          return url && url !== image.src;
        });
        image.onerror = null;
        if (fallback) image.src = fallback;
      };
      image.src = property.photos[0];
    }

    var info = card.querySelector(".pi");
    var rooms = Array.isArray(property.rooms) ? property.rooms : [];
    if (rooms.length) addRoomPrice(info, rooms[0]);
    card.setAttribute("data-supabase-property-id", property.id || "");
    card.setAttribute("data-listing-source", "supabase");
  }

  function addWonderway(property) {
    var grid = document.querySelector("#props .pg");
    if (!grid) return;

    var card = grid.querySelector('[data-property-slug="wonderway-retreat"]');
    if (!card) {
      card = document.createElement("a");
      // Do not use the "rv" class: it relies on the site's scroll-reveal observer,
      // and dynamically inserted cards otherwise remain invisible.
      card.className = "prop";
      card.setAttribute("data-property-slug", "wonderway-retreat");

      var photoBox = document.createElement("div");
      photoBox.className = "ph";
      var info = document.createElement("div");
      info.className = "pi";

      var label = document.createElement("small");
      label.textContent = "Stay in Jari";
      var title = document.createElement("h3");
      var description = document.createElement("p");
      var price = document.createElement("p");
      price.className = "supabase-room-price";
      var link = document.createElement("span");
      link.className = "lnk";
      link.textContent = "Enquire on WhatsApp →";

      info.appendChild(label);
      info.appendChild(title);
      info.appendChild(description);
      info.appendChild(price);
      info.appendChild(link);
      card.appendChild(photoBox);
      card.appendChild(info);

      var placeholder = grid.querySelector(".prop.soon");
      grid.insertBefore(card, placeholder || null);
    }

    card.href = makeWhatsAppUrl(property, (property.rooms || [])[0]);
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.setAttribute("data-supabase-property-id", property.id || "");
    card.setAttribute("data-listing-source", "supabase");

    var photoContainer = card.querySelector(".ph");
    var photo = Array.isArray(property.photos) ? property.photos[0] : "";
    if (photoContainer && photo) {
      var image = photoContainer.querySelector("img");
      if (!image) {
        image = document.createElement("img");
        photoContainer.appendChild(image);
      }
      image.alt = property.name || "Wonderway Retreat";
      image.loading = "lazy";
      image.style.width = "100%";
      image.style.height = "100%";
      image.style.objectFit = "cover";
      image.onerror = function () {
        var photos = Array.isArray(property.photos) ? property.photos : [];
        var fallback = photos.find(function (url) { return url && url !== image.src; });
        image.onerror = null;
        if (fallback) image.src = fallback;
      };
      image.src = photo;
    }

    var infoBox = card.querySelector(".pi");
    var titleNode = infoBox && infoBox.querySelector("h3");
    var descriptionNode = infoBox && infoBox.querySelector("p:not(.supabase-room-price)");
    var linkNode = infoBox && infoBox.querySelector(".lnk");
    if (titleNode) titleNode.textContent = property.name || "Wonderway Retreat";
    if (descriptionNode) descriptionNode.textContent =
      locationText(property) + ". A peaceful mountain stay.";
    if (linkNode) linkNode.textContent = "Enquire on WhatsApp →";
    addRoomPrice(infoBox, (property.rooms || [])[0]);
  }

  function renderRoomDetails(property) {
    // The existing Yash detail view is already part of index.html.
    // Populate a dedicated section inside it from the database each time data loads.
    var view = document.querySelector('[data-r="stays-yash"]');
    if (!view || !property) return;

    var section = view.querySelector("#supabase-room-details");
    if (!section) {
      section = document.createElement("section");
      section.id = "supabase-room-details";
      section.className = "sec";
      section.style.cssText = "padding:28px 0;";
      var inner = document.createElement("div");
      inner.className = "wrap";
      section.appendChild(inner);
      view.appendChild(section);
    }

    var innerBox = section.querySelector(".wrap");
    innerBox.textContent = "";

    var heading = document.createElement("h2");
    heading.textContent = "Rooms & Rates";
    innerBox.appendChild(heading);

    var intro = document.createElement("p");
    intro.textContent = "Room details and nightly prices are updated automatically from the property's live listing data.";
    innerBox.appendChild(intro);

    var rooms = Array.isArray(property.rooms) ? property.rooms : [];
    if (!rooms.length) {
      var empty = document.createElement("p");
      empty.textContent = "Room information is currently being updated. Please contact the property for details.";
      innerBox.appendChild(empty);
      return;
    }

    var table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;margin-top:16px;";
    var thead = document.createElement("thead");
    var headerRow = document.createElement("tr");
    ["Room", "Guests", "Price / night", "Details"].forEach(function (text) {
      var th = document.createElement("th");
      th.textContent = text;
      th.style.cssText = "text-align:left;padding:12px 8px;border-bottom:1px solid #d8ded8;";
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    rooms.forEach(function (room) {
      var row = document.createElement("tr");
      [room.room_name || "Room", String(room.max_guests || "—"), money(room.base_price)].forEach(function (text) {
        var cell = document.createElement("td");
        cell.textContent = text;
        cell.style.cssText = "padding:12px 8px;border-bottom:1px solid #e5e9e5;vertical-align:top;";
        row.appendChild(cell);
      });
      var detailsCell = document.createElement("td");
      detailsCell.style.cssText = "padding:12px 8px;border-bottom:1px solid #e5e9e5;vertical-align:top;";
      detailsCell.textContent = room.description || "Contact the property for room details.";
      row.appendChild(detailsCell);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    innerBox.appendChild(table);

    var note = document.createElement("p");
    note.style.cssText = "font-size:.9em;margin-top:12px;";
    note.textContent = "Prices are the listed base rates per night. Confirm availability, taxes, meals and final charges directly before booking.";
    innerBox.appendChild(note);
  }

  function loadProperties() {
    fetch(endpoint, {
      method: "GET",
      headers: { "Accept": "application/json" },
      cache: "no-store"
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Properties API returned " + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data || data.ok !== true || !Array.isArray(data.properties)) return;
        latestProperties = data.properties;

        latestProperties.forEach(function (property) {
          if (property.slug === "yash-home-stay") {
            updateYash(property);
            renderRoomDetails(property);
          }
          if (property.slug === "wonderway-retreat") addWonderway(property);
        });
      })
      .catch(function (error) {
        console.warn("Uttarkunth Stays: using existing listing fallback.", error);
      });
  }

  // Re-render details if the site's single-page router opens Yash after the API load.
  document.addEventListener("click", function (event) {
    var link = event.target.closest('a[href="#/stays-yash"]');
    if (!link) return;
    window.setTimeout(function () {
      var property = latestProperties.find(function (item) {
        return item.slug === "yash-home-stay";
      });
      if (property) renderRoomDetails(property);
    }, 100);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadProperties, { once: true });
  } else {
    loadProperties();
  }
})();
