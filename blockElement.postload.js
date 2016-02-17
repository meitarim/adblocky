/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2016 Eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

"use strict";

// The page ID for the popup filter selection dialog (top frame only).
let blockelementPopupId = null;

// Element picking state (top frame only).
let currentlyPickingElement = false;
let lastMouseOverEvent = null;

// During element picking this is the currently highlighted element. When
// element has been picked this is the element that is due to be blocked.
let currentElement = null;

// Highlighting state, used by the top frame during element picking and all
// frames when the chosen element is highlighted red.
let highlightedElementsSelector = null;
let highlightedElementsInterval = null;

// Last right click state stored for element blocking via the context menu.
let lastRightClickEvent = null;
let lastRightClickEventIsMostRecent = false;


/* Utilities */

function getFiltersForElement(element, callback)
{
  ext.backgroundPage.sendMessage(
  {
    type: "compose-filters",
    tagName: element.localName,
    id: element.id,
    src: element.getAttribute("src"),
    style: element.getAttribute("style"),
    classes: Array.prototype.slice.call(element.classList),
    urls: getURLsFromElement(element),
    mediatype: typeMap[element.localName],
    baseURL: document.location.href
  },
  response =>
  {
    callback(response.filters, response.selectors);
  });
}

function getBlockableElementOrAncestor(element, callback)
{
  // We assume that the user doesn't want to block the whole page.
  // So we never consider the <html> or <body> element.
  while (element && element != document.documentElement &&
         element != document.body)
  {
    // We can't handle non-HTML (like SVG) elements, as well as
    // <area> elements (see below). So fall back to the parent element.
    if (!(element instanceof HTMLElement) || element.localName == "area")
      element = element.parentElement;

    // If image maps are used mouse events occur for the <area> element.
    // But we have to block the image associated with the <map> element.
    else if (element.localName == "map")
    {
      let images = document.querySelectorAll("img[usemap]");
      let image = null;

      for (let i = 0; i < images.length; i++)
      {
        let usemap = images[i].getAttribute("usemap");
        let index = usemap.indexOf("#");

        if (index != -1 && usemap.substr(index + 1) == element.name)
        {
          image = images[i];
          break;
        }
      }

      element = image;
    }

    // Finally, if none of the above is true, check whether we can generate
    // any filters for this element. Otherwise fall back to its parent element.
    else
    {
      getFiltersForElement(element, filters =>
      {
        if (filters.length > 0)
          callback(element);
        else
          getBlockableElementOrAncestor(element.parentElement, callback);
      });

      return;
    }
  }

  // We reached the document root without finding a blockable element.
  callback(null);
}


/* Element highlighting */

// Adds an overlay to an element, which is probably a Flash object.
function addElementOverlay(element)
{
  let position = "absolute";
  let offsetX = window.scrollX;
  let offsetY = window.scrollY;

  for (let e = element; e; e = e.parentElement)
  {
    let style = getComputedStyle(e);

    // If the element isn't rendered (since its or one of its ancestor's
    // "display" property is "none"), the overlay wouldn't match the element.
    if (style.display == "none")
      return null;

    // If the element or one of its ancestors uses fixed postioning, the overlay
    // must too. Otherwise its position might not match the element's.
    if (style.position == "fixed")
    {
      position = "fixed";
      offsetX = offsetY = 0;
    }
  }

  let overlay = document.createElement("div");
  overlay.prisoner = element;
  overlay.className = "__adblockplus__overlay";
  overlay.setAttribute("style", "opacity:0.4; display:inline-box; " +
                                "overflow:hidden; box-sizing:border-box;");
  let rect = element.getBoundingClientRect();
  overlay.style.width = rect.width + "px";
  overlay.style.height = rect.height + "px";
  overlay.style.left = (rect.left + offsetX) + "px";
  overlay.style.top = (rect.top + offsetY) + "px";
  overlay.style.position = position;
  overlay.style.zIndex = 0x7FFFFFFE;

  document.documentElement.appendChild(overlay);
  return overlay;
}

function highlightElement(element, shadowColor, backgroundColor)
{
  unhighlightElement(element);

  let highlightWithOverlay = function()
  {
    let overlay = addElementOverlay(element);

    // If the element isn't displayed no overlay will be added.
    // Moreover, we don't need to highlight anything then.
    if (!overlay)
      return;

    highlightElement(overlay, shadowColor, backgroundColor);
    overlay.style.pointerEvents = "none";

    element._unhighlight = () =>
    {
      overlay.parentNode.removeChild(overlay);
    };
  };

  let highlightWithStyleAttribute = function()
  {
    let originalBoxShadow = element.style.getPropertyValue("box-shadow");
    let originalBoxShadowPriority =
      element.style.getPropertyPriority("box-shadow");
    let originalBackgroundColor =
      element.style.getPropertyValue("background-color");
    let originalBackgroundColorPriority =
      element.style.getPropertyPriority("background-color");

    element.style.setProperty("box-shadow", "inset 0px 0px 5px " + shadowColor,
                              "important");
    element.style.setProperty("background-color", backgroundColor, "important");

    element._unhighlight = () =>
    {
      element.style.removeProperty("box-shadow");
      element.style.setProperty(
        "box-shadow",
        originalBoxShadow,
        originalBoxShadowPriority
      );

      element.style.removeProperty("background-color");
      element.style.setProperty(
        "background-color",
        originalBackgroundColor,
        originalBackgroundColorPriority
      );
    };
  };

  if ("prisoner" in element)
    highlightWithStyleAttribute();
  else
    highlightWithOverlay();
}

function unhighlightElement(element)
{
  if (element && "_unhighlight" in element)
  {
    element._unhighlight();
    delete element._unhighlight;
  }
}

// Highlight elements matching the selector string red.
// (All elements that would be blocked by the proposed filters.)
function highlightElements(selectorString)
{
  unhighlightElements();

  let elements = Array.prototype.slice.call(
    document.querySelectorAll(selectorString)
  );
  highlightedElementsSelector = selectorString;

  // Highlight elements progressively. Otherwise the page freezes
  // when a lot of elements get highlighted at the same time.
  highlightedElementsInterval = setInterval(() =>
  {
    if (elements.length > 0)
    {
      let element = elements.shift();
      if (element != currentElement)
        highlightElement(element, "#fd6738", "#f6e1e5");
    }
    else
    {
      clearInterval(highlightedElementsInterval);
      highlightedElementsInterval = null;
    }
  }, 0);
}

// Unhighlight the elements that were highlighted by selector string previously.
function unhighlightElements()
{
  if (highlightedElementsInterval)
  {
    clearInterval(highlightedElementsInterval);
    highlightedElementsInterval = null;
  }

  if (highlightedElementsSelector)
  {
    Array.prototype.forEach.call(
      document.querySelectorAll(highlightedElementsSelector),
      unhighlightElement
    );

    highlightedElementsSelector = null;
  }
}


/* Input event handlers */

function stopEventPropagation(event)
{
  event.stopPropagation();
}

// Hovering over an element so highlight it.
function mouseOver(event)
{
  lastMouseOverEvent = event;

  getBlockableElementOrAncestor(event.target, element =>
  {
    if (event == lastMouseOverEvent)
    {
      lastMouseOverEvent = null;

      if (currentlyPickingElement)
      {
        if (currentElement)
          unhighlightElement(currentElement);

        if (element)
          highlightElement(element, "#d6d84b", "#f8fa47");

        currentElement = element;
      }
    }
  });

  event.stopPropagation();
}

// No longer hovering over this element so unhighlight it.
function mouseOut(event)
{
  if (!currentlyPickingElement || currentElement != event.target)
    return;

  unhighlightElement(currentElement);
  event.stopPropagation();
}

// Key events - Return selects currently hovered-over element, escape aborts.
function keyDown(event)
{
  if (!event.ctrlKey && !event.altKey && !event.shiftKey)
  {
    if (event.keyCode == 13) // Return
      elementPicked(event);
    else if (event.keyCode == 27) // Escape
      deactivateBlockElement();
  }
}


/* Element selection */

// Start highlighting elements yellow as the mouse moves over them, when one is
// chosen launch the popup dialog for the user to confirm the generated filters.
function startPickingElement()
{
  currentlyPickingElement = true;

  // Add overlays for blockable elements that don't emit mouse events,
  // so that they can still be selected.
  Array.prototype.forEach.call(
    document.querySelectorAll("object,embed,iframe,frame"),
    element =>
    {
      getFiltersForElement(element, filters =>
      {
        if (filters.length > 0)
          addElementOverlay(element);
      });
    }
  );

  document.addEventListener("mousedown", stopEventPropagation, true);
  document.addEventListener("mouseup", stopEventPropagation, true);
  document.addEventListener("mouseenter", stopEventPropagation, true);
  document.addEventListener("mouseleave", stopEventPropagation, true);
  document.addEventListener("mouseover", mouseOver, true);
  document.addEventListener("mouseout", mouseOut, true);
  document.addEventListener("click", elementPicked, true);
  document.addEventListener("contextmenu", elementPicked, true);
  document.addEventListener("keydown", keyDown, true);

  ext.onExtensionUnloaded.addListener(deactivateBlockElement);
}

// The user has picked an element - currentElement. Highlight it red, generate
// filters for it and open a popup dialog so that the user can confirm.
function elementPicked(event)
{
  if (!currentElement)
    return;

  let element = currentElement.prisoner || currentElement;
  getFiltersForElement(element, (filters, selectors) =>
  {
    if (currentlyPickingElement)
      stopPickingElement();

    ext.backgroundPage.sendMessage(
    {
      type: "blockelement-open-popup"
    },
    response =>
    {
      blockelementPopupId = response;
      ext.backgroundPage.sendMessage(
      {
        type: "forward",
        targetPageId: blockelementPopupId,
        payload:
        {
          type: "blockelement-popup-init",
          filters: filters
        }
      });
    });

    if (selectors.length > 0)
      highlightElements(selectors.join(","));

    highlightElement(currentElement, "#fd1708", "#f6a1b5");
  });

  event.preventDefault();
  event.stopPropagation();
}

function stopPickingElement()
{
  currentlyPickingElement = false;

  document.removeEventListener("mousedown", stopEventPropagation, true);
  document.removeEventListener("mouseup", stopEventPropagation, true);
  document.removeEventListener("mouseenter", stopEventPropagation, true);
  document.removeEventListener("mouseleave", stopEventPropagation, true);
  document.removeEventListener("mouseover", mouseOver, true);
  document.removeEventListener("mouseout", mouseOut, true);
  document.removeEventListener("click", elementPicked, true);
  document.removeEventListener("contextmenu", elementPicked, true);
  document.removeEventListener("keydown", keyDown, true);
}


/* Core logic */

// We're done with the block element feature for now, tidy everything up.
function deactivateBlockElement()
{
  if (currentlyPickingElement)
    stopPickingElement();

  if (blockelementPopupId != null)
  {
    ext.backgroundPage.sendMessage(
    {
      type: "forward",
      targetPageId: blockelementPopupId,
      payload:
      {
        type: "blockelement-close-popup"
      }
    });

    blockelementPopupId = null;
  }

  lastRightClickEvent = null;

  if (currentElement)
  {
    unhighlightElement(currentElement);
    currentElement = null;
  }
  unhighlightElements();

  let overlays = document.getElementsByClassName("__adblockplus__overlay");
  while (overlays.length > 0)
    overlays[0].parentNode.removeChild(overlays[0]);

  ext.onExtensionUnloaded.removeListener(deactivateBlockElement);
}

// In Chrome 37-40, the document_end content script (this one) runs properly,
// while the document_start content scripts (that defines ext) might not. Check
// whether variable ext exists before continuing to avoid
// "Uncaught ReferenceError: ext is not defined". See https://crbug.com/416907
if ("ext" in window && document instanceof HTMLDocument)
{
  // Use a contextmenu handler to save the last element the user right-clicked
  // on. To make things easier, we actually save the DOM event. We have to do
  // this because the contextMenu API only provides a URL, not the actual DOM
  // element.
  //   We also need to make sure that the previous right click event,
  // if there is one, is removed. We don't know which frame it is in so we must
  // send a message to the other frames to clear their old right click events.
  document.addEventListener("contextmenu", event =>
  {
    lastRightClickEvent = event;
    lastRightClickEventIsMostRecent = true;

    ext.backgroundPage.sendMessage(
    {
      type: "forward",
      payload:
      {
        type: "blockelement-clear-previous-right-click-event"
      }
    });
  }, true);

  ext.onMessage.addListener((msg, sender, sendResponse) =>
  {
    switch (msg.type)
    {
      case "blockelement-get-state":
        if (window == window.top)
          sendResponse({
            active: currentlyPickingElement || blockelementPopupId != null
          });
        break;
      case "blockelement-start-picking-element":
        if (window == window.top)
          startPickingElement();
        break;
      case "blockelement-context-menu-clicked":
        let event = lastRightClickEvent;
        deactivateBlockElement();
        if (event)
        {
          getBlockableElementOrAncestor(event.target, element =>
          {
            if (element)
            {
              currentElement = element;
              elementPicked(event);
            }
          });
        }
        break;
      case "blockelement-finished":
        if (currentElement && msg.remove)
        {
          // Hide the selected element itself if an added blocking
          // filter is causing it to collapse. Note that this
          // behavior is incomplete, but the best we can do here,
          // e.g. if an added blocking filter matches other elements,
          // the effect won't be visible until the page is is reloaded.
          checkCollapse(currentElement.prisoner || currentElement);

          // Apply added element hiding filters.
          updateStylesheet();
        }
        deactivateBlockElement();
        break;
      case "blockelement-clear-previous-right-click-event":
        if (!lastRightClickEventIsMostRecent)
          lastRightClickEvent = null;
        lastRightClickEventIsMostRecent = false;
        break;
      case "blockelement-popup-closed":
        // The onRemoved hook for the popup can create a race condition, so we
        // to be careful here. (This is not perfect, but best we can do.)
        if (window == window.top && blockelementPopupId == msg.popupId)
        {
          ext.backgroundPage.sendMessage(
          {
            type: "forward",
            payload:
            {
              type: "blockelement-finished"
            }
          });
        }
        break;
    }
  });

  if (window == window.top)
    ext.backgroundPage.sendMessage({type: "report-html-page"});
}