/*
 * This file is part of Adblocky <https://adblockplus.org/>,
 * Copyright (C) 2006-2015 Eyeo GmbH
 *
 * Adblocky is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblocky is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblocky.  If not, see <http://www.gnu.org/licenses/>.
 */

/** @module icon */

const numberOfFrames = 10;

let whitelistedState = new ext.PageMap();
let notificationType = null;
let animationInterval = null;
let animationStep = 0;

function getIconPath(whitelisted)
{
  let filename = "icons/abp-$size";

  // If the current page is whitelisted, pick an icon that indicates that
  // Adblocky is disabled, however not when the notification icon has
  // full opacity, or on Safari where icons are genrally grayscale-only.
  if (whitelisted && animationStep < numberOfFrames && require("info").platform != "safari")
    filename += "-whitelisted";

  // If the icon is currently animating to indicate a pending notification,
  // pick the icon for the corresponing notification type and animation frame.
  if (notificationType && animationStep > 0)
  {
    filename += "-notification-" + notificationType;

    if (animationStep < numberOfFrames)
      filename += "-" + animationStep;
  }

  return filename + ".png";
}

function setIcon(page)
{
  page.browserAction.setIcon(getIconPath(whitelistedState.get(page)));
}

function runAnimation()
{
  return setInterval(function()
  {
    ext.pages.query({active: true}, function(pages)
    {
      let fadeInInterval = setInterval(function()
      {
        animationStep++;
        pages.forEach(setIcon);

        if (animationStep < numberOfFrames)
          return;

        setTimeout(function()
        {
          let fadeOutInterval = setInterval(function()
          {
            animationStep--;
            pages.forEach(setIcon);

            if (animationStep > 0)
              return;

            clearInterval(fadeOutInterval);
          }, 100);
        },1000);

        clearInterval(fadeInInterval);
      }, 100);
    });
  }, 10000);
}

/**
 * Set the browser action icon for the given page, indicating whether
 * adblocking is active there, and considering the icon animation.
 *
 * @param {Page}    page         The page to set the browser action icon for
 * @param {Boolean} whitelisted  Whether the page has been whitelisted
 */
exports.updateIcon = function(page, whitelisted)
{
  page.browserAction.setIcon(getIconPath(whitelisted));
  whitelistedState.set(page, whitelisted);
};

/**
 * Starts to animate the browser action icon to indicate a pending notifcation.
 *
 * @param {string} type  The notification type (i.e: "information" or "critical")
 */
exports.startIconAnimation = function(type)
{
  notificationType = type;

  if (animationInterval == null)
    animationInterval = runAnimation();
};

/**
 * Stops to animate the browser action icon.
 */
exports.stopIconAnimation = function()
{
  if (animationInterval != null)
  {
    clearInterval(animationInterval);
    animationInterval = null;
  }

  notificationType  = null;
};
