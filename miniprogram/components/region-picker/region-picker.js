// 地区选择（省 / 市 / 区）。只生成 `中国 省 市 区` 这个串，解析交给服务端。
//
// 为什么不直接用 picker mode="multiSelector"：三列联动要在 change 里重建列并复位索引，
// 一旦某列变短就会索引越界（小程序不会报错，只是显示错位）。三个独立 picker
// 各自只管自己一级，逻辑少一半，也不会跳。
const { loadChina, buildRegion, splitRegion } = require('../../utils/regions');

const EMPTY = { province: '', city: '', district: '' };

Component({
  properties: {
    value: {
      type: String,
      value: '',
      observer(v) {
        // 父页面改值时重建三级列表。初始化时也会跑一次，此时数据还没到，
        // _syncFromValue 会直接返回，等 _load 完成后再统一同步。
        this._syncFromValue(v);
      }
    },
    disabled: { type: Boolean, value: false }
  },

  data: {
    provinceList: [],
    cityList: [],
    areaList: [],
    iProv: 0,
    iCity: 0,
    iArea: 0,
    province: '',
    city: '',
    district: '',
    failed: false
  },

  lifetimes: {
    attached() {
      this.china = null;
      this._load();
    }
  },

  methods: {
    _load() {
      loadChina()
        .then((china) => {
          this.china = china;
          this._syncFromValue(this.data.value);
        })
        .catch(() => {
          // 取不到就降级：父页面看到 failed 仍可只填具体地点，不阻塞提交
          this.setData({ failed: true });
        });
    },

    /** 按当前 value 重建三级列表与索引（幂等，值没变时重建结果一样） */
    _syncFromValue(v) {
      const china = this.china;
      if (!china) return;
      const p = splitRegion(v);

      const provinceList = china.map((x) => x.name);
      let iProv = provinceList.indexOf(p.province);
      if (iProv < 0) iProv = 0;
      const provObj = china[iProv];
      const cities = (provObj && provObj.cities) || [];
      const cityList = cities.map((c) => c.name);
      let iCity = cityList.indexOf(p.city);
      if (iCity < 0) iCity = 0;
      const cityObj = cities[iCity];
      const areaList = (cityObj && cityObj.areas) || [];
      let iArea = areaList.indexOf(p.district);
      if (iArea < 0) iArea = 0;

      this.setData({
        provinceList: provinceList,
        cityList: cityList,
        areaList: areaList,
        iProv: iProv,
        iCity: iCity,
        iArea: iArea,
        province: p.province,
        city: p.city,
        district: p.district
      });
    },

    _emit(patch) {
      const next = {
        province: patch.province !== undefined ? patch.province : this.data.province,
        city: patch.city !== undefined ? patch.city : this.data.city,
        district: patch.district !== undefined ? patch.district : this.data.district
      };
      this.setData(next);
      this.triggerEvent('change', { value: buildRegion(next) });
    },

    onProv(e) {
      if (!this.china) return;
      const i = Number(e.detail.value) || 0;
      const provObj = this.china[i];
      const cities = (provObj && provObj.cities) || [];
      // 换省必须把市/区清掉，否则会拼出「广东省 东城区」这种跨省组合
      this.setData({
        iProv: i,
        cityList: cities.map((c) => c.name),
        areaList: [],
        iCity: 0,
        iArea: 0
      });
      this._emit({ province: provObj ? provObj.name : '', city: '', district: '' });
    },

    onCity(e) {
      if (!this.china) return;
      const i = Number(e.detail.value) || 0;
      const provObj = this.china[this.data.iProv];
      const cities = (provObj && provObj.cities) || [];
      const cityObj = cities[i];
      this.setData({ iCity: i, areaList: (cityObj && cityObj.areas) || [], iArea: 0 });
      this._emit({ city: cityObj ? cityObj.name : '', district: '' });
    },

    onArea(e) {
      const i = Number(e.detail.value) || 0;
      this.setData({ iArea: i });
      this._emit({ district: this.data.areaList[i] || '' });
    },

    clear() {
      this.setData(EMPTY);
      this.triggerEvent('change', { value: '' });
    }
  }
});
