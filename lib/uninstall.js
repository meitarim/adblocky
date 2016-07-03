/*
 * This file is part of Ad Blocking Community <https://adblockplus.org/>,
 * Copyright (C) 2006-2015 Eyeo GmbH
 *
 * Ad Blocking Community is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Ad Blocking Community is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Ad Blocking Community.  If not, see <http://www.gnu.org/licenses/>.
 */

/** @module uninstall */

let info = require("info");
let {Prefs} = require("prefs");
let {Utils} = require("utils");

function setUninstallURL()
{
  let search = [];
  let keys = ["addonName", "addonVersion", "application", "applicationVersion",
              "platform", "platformVersion"];
  for (let key of keys)
    search.push(key + "=" + encodeURIComponent(info[key]));

  let downlCount = Prefs.notificationdata.downloadCount || 0;
  search.push("notificationDownloadCount=" + encodeURIComponent(downlCount));

  chrome.runtime.setUninstallURL((Utils.getDocLink("uninstalled") + "&" + search.join("&")).substr(0,255));  
}

function onPrefsLoaded()
{
  Prefs.onLoaded.removeListener(onPrefsLoaded);
  setUninstallURL();
}

// The uninstall URL contains the notification download count as a parameter,
// therefore we must wait for preferences to be loaded before generating the
// URL and we need to re-generate it each time the notification data changes.
if ("setUninstallURL" in chrome.runtime)
{
  Prefs.onLoaded.addListener(onPrefsLoaded);
  Prefs.onChanged.addListener(function(name)
  {
    if (name == "notificationdata")
      setUninstallURL();
  });
}
