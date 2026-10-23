#
# luci-theme-darkvibe — тёмная тема для LuCI в фирменной гамме free-net
# (графит + лайм, сайдбар слева, шрифт Onest).
#
# Структура пакета поддерживает оба поколения LuCI:
#   - ucode/template/...  → OpenWrt 23.05 / 24.10+ (ucode-движок шаблонов)
#   - luasrc/view/...     → OpenWrt ≤ 22.03 и прошивки на его основе (в т.ч. GL.iNet)
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=DarkVibe Theme
LUCI_DEPENDS:=+luci-base
LUCI_TYPE:=theme
LUCI_PKGARCH:=all

PKG_NAME:=luci-theme-darkvibe
PKG_VERSION:=1.4.2
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=free-net

# Не сжимать CSS csstidy — он ломает современный синтаксис ( :is(), переменные ).
CONFIG_LUCI_CSSTIDY:=

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
