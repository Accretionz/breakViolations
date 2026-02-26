import JSZip from "jszip";
import { saveAs } from "file-saver";

/* ----------------------------
   Types
---------------------------- */

export interface Violation {

  employee: string;

  date: string;

  workedHours: number;

  breakHours: number;

  requiredBreak: number;

}

export interface Violations {

  critical: Violation[];

  standard: Violation[];

}


/* =====================================================
   SUMMARY TXT DOWNLOAD
===================================================== */

export function downloadSummary(
  violations: any
) {

  console.log("Downloading summary...");

  const all = [

    ...(violations.critical ?? []),

    ...(violations.standard ?? [])

  ];

  //--------------------------------
  // GROUP EMPLOYEES
  //--------------------------------

  const grouped =
    new Map<string, any[]>();

  all.forEach((v:any)=>{

    if(!grouped.has(v.employee)){

      grouped.set(v.employee,[]);

    }

    grouped.get(v.employee)!.push(v);

  });

  //--------------------------------
  // REPORT TEXT
  //--------------------------------

  let report =
"BREAK COMPLIANCE VIOLATIONS - SUMMARY REPORT\n\n";

  report +=
`Total Violations: ${all.length}\n\n`;

  grouped.forEach(

    (violations,employee)=>{

      report += `${employee}\n`;

      violations.forEach((v:any)=>{

        report +=
` • ${v.date}\n`;

      });

      report += "\n";

    }

  );

  //--------------------------------
  // DOWNLOAD
  //--------------------------------

  const blob = new Blob(

    [report],

    {

      type:"text/plain"

    }

  );

  const url =
    window.URL.createObjectURL(blob);

  const a =
    document.createElement("a");

  a.href = url;

  a.download =
    "_SUMMARY_REPORT.txt";

  document.body.appendChild(a);

  a.click();

  document.body.removeChild(a);

  window.URL.revokeObjectURL(url);

}


/* =====================================================
   ZIP DOWNLOAD
===================================================== */

export async function downloadZip(

  violations: Violations,

  fileName: string

) {

  const zip = new JSZip();

  //--------------------------------
  // CSV filename = root folder
  //--------------------------------

  const rootName =
    fileName.replace(".csv","");

  const rootFolder =
    zip.folder(rootName)!;

  //--------------------------------
  // Combine violations
  //--------------------------------

  const all = [

    ...violations.critical,

    ...violations.standard

  ];

  //--------------------------------
  // Group employees
  //--------------------------------

  const grouped =
    new Map<string,string[]>();

  all.forEach(v => {

    if(!grouped.has(v.employee)){

      grouped.set(v.employee,[]);

    }

    grouped.get(v.employee)!
      .push(v.date);

  });

  //--------------------------------
  // Folder Structure
  //--------------------------------

  grouped.forEach(

    (dates,employee)=>{

      const employeeFolder =
        rootFolder.folder(employee)!;

      dates.forEach(date=>{

        employeeFolder.file(

          `${date}.txt`,

          ""

        );

      });

    }

  );

  //--------------------------------
  // Generate ZIP
  //--------------------------------

  const blob =
    await zip.generateAsync({

      type:"blob"

    });

  saveAs(

    blob,

    `${rootName}_violations.zip`

  );

}