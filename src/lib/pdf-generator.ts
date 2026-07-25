import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export async function generatePayoffPDF(
  containerElement: HTMLElement,
  fileName: string = "Plano_de_Quitacao.pdf"
): Promise<void> {
  const pages = containerElement.querySelectorAll<HTMLElement>(".a4-page");
  if (pages.length === 0) {
    throw new Error("Nenhuma página A4 encontrada para gerar o PDF.");
  }

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const pdfWidth = pdf.internal.pageSize.getWidth(); // 210mm
  const pdfHeight = pdf.internal.pageSize.getHeight(); // 297mm

  let isFirstPage = true;

  for (let i = 0; i < pages.length; i++) {
    const pageEl = pages[i];

    // Capture element with html2canvas at 2x resolution for ultra-sharp text
    const canvas = await html2canvas(pageEl, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: 1200,
    });

    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    const imgHeightMm = (canvas.height * pdfWidth) / canvas.width;

    if (imgHeightMm > pdfHeight + 2) {
      // Content exceeds 1 page: render multi-page slice
      let heightLeft = imgHeightMm;
      let position = 0;

      while (heightLeft > 0) {
        if (!isFirstPage) {
          pdf.addPage();
        }
        isFirstPage = false;

        pdf.addImage(imgData, "JPEG", 0, -position, pdfWidth, imgHeightMm, undefined, "FAST");
        heightLeft -= pdfHeight;
        position += pdfHeight;
      }
    } else {
      if (!isFirstPage) {
        pdf.addPage();
      }
      isFirstPage = false;
      pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, pdfHeight, undefined, "FAST");
    }
  }

  pdf.save(fileName);
}
