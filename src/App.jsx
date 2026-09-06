import { useEffect, useRef } from "react";
import { initializeCatalog } from "./catalog.js";
import brandLogo from "../furni-catalog-assets/brand-logo.png";
import introLogo from "../furni-catalog-assets/introLogo.png";
import gallery0 from "../furni-catalog-assets/galImg0.jpg";
import gallery1 from "../furni-catalog-assets/galImg1.jpg";
import gallery2 from "../furni-catalog-assets/galImg2.jpg";
import gallery3 from "../furni-catalog-assets/galImg3.jpg";
import galleryMobile from "../furni-catalog-assets/galSplitMobile.jpg";
import sofaLeft from "../furni-catalog-assets/sofaLeft.png";
import sofaRight from "../furni-catalog-assets/sofaRight.png";

export default function App() {
  const catalogRef = useRef(null);

  // The existing catalog controller owns the empty product/specification containers.
  useEffect(() => initializeCatalog(catalogRef.current), []);

  return (
    <div ref={catalogRef}>
      <div id="app">
        <Header />
        <Intro />
        <Catalog />
      </div>
      <Lightbox />
      <AdminPanel />
    </div>
  );
}

function Header() {
  return (
    <header id="siteHeader">
      <div className="brand">
        <img className="brand-logo" src={brandLogo} alt="Furni.group" />
      </div>
      <div className="search-wrap">
        <input
          type="text"
          id="idSearch"
          placeholder="Поиск по ID, напр. M0012"
        />
        <button className="search-go" id="idSearchBtn">
          Найти
        </button>
      </div>
      <button className="admin-link" id="openAdmin">
        Админ панель
      </button>
    </header>
  );
}

function Intro() {
  return (
    <section id="intro">
      <div className="intro-stage" id="introStage">
        <div className="intro-stage-inner" id="introStageInner">
          <div className="intro-bg-gallery" id="introGallery">
            <div className="intro-bg-col">
              <picture>
                <source media="(max-width:500px)" srcSet={galleryMobile} />
                <img id="galImg0" src={gallery0} alt="" />
              </picture>
            </div>
            <div className="intro-bg-col">
              <picture>
                <source media="(max-width:500px)" srcSet={galleryMobile} />
                <img id="galImg1" src={gallery1} alt="" />
              </picture>
            </div>
            <div className="intro-bg-col">
              <img id="galImg2" src={gallery2} alt="" />
            </div>
            <div className="intro-bg-col">
              <img id="galImg3" src={gallery3} alt="" />
            </div>
          </div>
          <div className="intro-bg-overlay"></div>
          <img
            className="intro-sofa sofa-half-left"
            id="sofaLeft"
            src={sofaLeft}
            alt=""
          />
          <img
            className="intro-sofa sofa-half-right"
            id="sofaRight"
            src={sofaRight}
            alt=""
          />
          <img
            className="intro-logo"
            id="introLogo"
            src={introLogo}
            alt="Furni.group"
          />
          <div className="intro-hint" id="introHint">
            <span>Прокрутите вниз</span>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 4v16m0 0l-6-6m6 6l6-6"></path>
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}

function Catalog() {
  return (
    <main id="mainContent">
      <div className="hero">
        <div className="hero-eyebrow">Каталог продукции</div>
        <h1>Вся мебель — в одном месте</h1>
        <p>Выберите категорию или найдите изделие по его ID-номеру.</p>
      </div>

      <div className="cat-rail" id="catRail"></div>

      <div className="grid" id="grid"></div>
    </main>
  );
}

function Lightbox() {
  return (
    <div id="lightbox">
      <button className="lb-close" id="lbClose">
        &times;
      </button>
      <div className="lb-img-wrap" id="lbImgWrap">
        <div className="loader" id="lbLoader" style={{ display: "none" }}></div>
        <img id="lbImg" alt="" draggable={false} />
        <span className="lb-counter" id="lbCounter"></span>
      </div>
      <div className="lb-info">
        <span className="card-tag" id="lbTag"></span>
        <span className="card-cat" id="lbCat"></span>
        <h4 className="lb-specs-title" id="lbSpecsTitle">
          Характеристики
        </h4>
        <div className="lb-specs" id="lbSpecs"></div>
      </div>
    </div>
  );
}

function AdminPanel() {
  return (
    <div id="adminPanel">
      <div className="admin-shell">
        <div className="admin-head">
          <div className="brand">
            <div className="brand-mark">F</div>
            <div className="brand-name">
              Админ<span> панель</span>
            </div>
          </div>
          <button className="back-btn" id="closeAdmin">
            ← Назад в каталог
          </button>
        </div>

        <div className="upload-box">
          <h3>Добавить мебель</h3>
          <div className="field">
            <label>Категория</label>
            <select id="uploadCat"></select>
          </div>
          <div className="field">
            <label>Информация об изделии</label>
            <div id="specFields"></div>
            <button type="button" className="add-spec-btn" id="addSpecBtn">
              + Добавить поле
            </button>
          </div>
          <div className="field">
            <label>Фото</label>
            <div className="file-drop" id="dropZone">
              <span id="dropLabel">
                Нажмите или перетащите изображение сюда
              </span>
              <input type="file" id="fileInput" accept="image/*" />
            </div>
            <div className="preview-thumbs" id="previewThumbs"></div>
          </div>
          <button className="submit-btn" id="uploadBtn">
            Загрузить и присвоить ID
          </button>
          <div className="status-msg" id="uploadStatus"></div>
        </div>

        <div className="upload-box" id="migrateBox" style={{ display: "none" }}>
          <h3>Ускорить каталог</h3>
          <p
            style={{
              color: "var(--muted)",
              fontSize: "13.5px",
              margin: "0 0 16px",
              lineHeight: "1.5",
            }}
          >
            Часть изделий была загружена до оптимизации и хранит полноразмерные
            фото прямо в списке каталога — из-за этого сайт долго грузится при
            входе. Нажмите кнопку, чтобы сжать превью для таких изделий (фото
            никуда не пропадут, только ускорится каталог).
          </p>
          <button className="submit-btn" id="migrateBtn">
            Оптимизировать старые изделия
          </button>
          <div className="status-msg" id="migrateStatus"></div>
        </div>

        <h3
          style={{
            fontFamily: "'Space Grotesk',sans-serif",
            fontWeight: "600",
            marginBottom: "14px",
          }}
        >
          Все изделия
        </h3>
        <div id="adminList"></div>
      </div>
    </div>
  );
}
